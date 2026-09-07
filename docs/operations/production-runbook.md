# 生产运行手册

本手册用于 OpenAPI 上线后的日常运行、异常排查和恢复。目标部署模型包含两个独立 Node.js 应用进程：Platform 使用 Nuxt/Nitro，API Service 使用轻量 Hono/TypeScript。两者分别升级和回滚；Platform 使用 PostgreSQL 并配置共享 Redis 后可水平扩容，API Service 通过独立 Upstream Target 扩容。

## 运行边界

| 项目 | 约束 |
| --- | --- |
| 应用进程 | 默认一个 Platform Node 进程和一个 API Service Node 进程；二者不共享 V8 Heap、环境变量或故障边界 |
| 数据库 | 仅 Platform 访问 PostgreSQL/PGlite；升级时由新 Platform 构建产物显式迁移，启动插件再幂等复查，API Service 不运行数据库迁移 |
| 限流 | 配置 Redis 时使用共享原子计数；未配置 Redis 时回退进程内计数，配置后 Redis 故障会 fail-closed |
| 短缓存 | Redis 缓存公开 DTO 与 API 守卫配置；故障时回源数据库，不缓存用户私有或敏感配置 |
| 扣费重试 | 每个实例都有定时器，但同一时刻仅 Redis lease 持有者扫描到期的 `api_credit_reservations` |
| 代理 | 生产公网流量由 Nginx 或等价代理转发到 `127.0.0.1:<NITRO_PORT>` |

## 日常巡检

每日或发布后检查：

```bash
# PM2 部署查看对应进程；Compose 部署查看对应容器。
pm2 status
pm2 logs openapi-platform --lines 120
pm2 logs openapi-service --lines 120
docker compose ps openapi-platform openapi-service
docker compose logs --tail=120 openapi-platform openapi-service

curl -fsS http://127.0.0.1:3000/api/health
curl -fsS http://127.0.0.1:3000/api/ready
curl -fsS http://127.0.0.1:3000/api/catalog
docker compose exec -T openapi-service node -e "fetch('http://127.0.0.1:8080/healthz').then(r=>{if(!r.ok)process.exit(1)})"
docker compose exec -T openapi-service node -e "fetch('http://127.0.0.1:8080/readyz').then(r=>{if(!r.ok)process.exit(1)})"
```

只执行与实际部署方式对应的 PM2 或 Compose 命令。API Service 直接以 Node/PM2 运行时，可改用宿主机 `curl` 检查 `127.0.0.1:8080`。

数据库侧重点：

| 检查项 | 异常信号 |
| --- | --- |
| `api_credit_reservations` | `pending` 持续增长、出现 `dead_letter`，或 `active` 长时间不释放 |
| `api_calls` | 动态 Route 的失败率突然升高、调用量异常或 `route_id` 缺失 |
| `credit_transactions` | 收费 Route 调用成功但没有对应 `route_id`、`api_call_id` 或扣费金额不符 |
| Route 每日聚合 | 检查 Route 聚合任务、聚合表和调用明细对账；兼容聚合数据不能替代 Route 统计 |
| `operation_logs` 中的 `auth.login.*` 事件 | 管理员登录失败集中爆发 |
| `operation_logs` | 敏感配置被频繁修改 |

## 日志定位

| 现象 | 优先查看 |
| --- | --- |
| 服务无法启动 | PM2 日志、`DATABASE_URL`、端口占用 |
| readiness 返回 503 | PostgreSQL 连接；配置 Redis 时同时检查 `NUXT_REDIS_URL`、认证和网络 |
| 只有某个 Service 的 API 返回 502/503 | 检查该 Service 容器、`/readyz`、Service Token、Target 和来源级错误；Platform 与其他 Service 的接口应保持可用 |
| 面板提示 package.json 无 scripts | 将工作目录设为 `.output` 或 GitHub Release 解压根目录并执行 `npm start`；不要把 `server` 当作工作目录 |
| SSR 提示缺少 `entities/decode` | 检查是否完整部署 `server/node_modules/.nitro`；改用 Linux CI/Docker 构建 |
| 扣费扫描持续跳过 | Redis lease 可用性、`NUXT_REDIS_URL` 和 `[credit-reservations]` 日志 |
| 数据库迁移失败 | `npm run migrate` 输出、`DATABASE_URL` 权限、`server/migrate.mjs` 和 `server/db/migrations/postgresql` 是否完整 |
| 管理后台无法登录 | `NUXT_AUTH_SECRET`、管理员账号状态、统一登录页、登录日志 |
| API Key 全部失效 | `NUXT_API_KEY_SECRET` 是否与加密时一致、`api_keys.key_digest` 是否存在、Key 是否被禁用、网关是否连接了预期数据库 |
| 邮箱验证失败 | `NUXT_AUTH_SECRET`、SMTP 配置、邮件发送日志 |
| 公开 API 429 增多 | API 配置、Redis/进程内限流窗口、调用方 IP 或 Key |
| 数据库读取突增 | Redis 可用性、命令延迟、内存、淘汰数和公开缓存命中情况 |
| 扣费异常 | `api_calls`、`credit_transactions`、`api_credit_reservations` |
| 审计记录疑似缺失 | stderr 中的 `AUDIT_FALLBACK` 标记（见下）、`operation_logs` 写入报错 |

## 审计降级采集（必配）

审计事件写入 `operation_logs`。落库失败时，Platform 会把完整审计行以单行 JSON 打到 **stderr**，前缀为固定标记 `AUDIT_FALLBACK`：

```text
AUDIT_FALLBACK {"marker":"AUDIT_FALLBACK","occurredAt":"...","reason":"...","log":{...}}
```

**这条降级通道只有在日志采集侧确实抓取并保留 stderr 时才成立。** 未配置采集时，落库失败的审计记录与没有降级通道一样是丢失的——这不是应用层能自行保证的部分。

上线前必须完成：

- 确认 PM2 / 容器运行时的 stderr 已被采集并纳入与数据库备份同等的保留周期。
- 在日志平台按 `AUDIT_FALLBACK` 建立告警：出现即意味着审计写入路径异常，需要立即排查数据库可用性。
- 演练一次从采集侧按该标记还原审计行的流程，确认 `log` 字段可直接还原成 `operation_logs` 记录。

安全敏感动作的失败语义按动作码分级（见 `shared/config/audit-actions.ts`）：`gate` 级（明文披露，如查看 API Key / 兑换码）写入失败会直接让请求报错，明文不会在无痕的情况下交付；`durable` 级不阻塞主流程，仅依赖上述降级通道。

## 备份策略

生产数据库至少保留每日备份。发布数据库迁移前必须手动创建一次备份或快照。

当前开发线的唯一 `0000` 是破坏性重建基线。旧 `0.1.0`、`0.1.1` 数据库和 PGlite Volume 不能原地升级；部署包含新基线的版本前必须保留备份并重建数据库，必要数据通过经过演练的导出/导入方案迁移。

```bash
pg_dump "$DATABASE_URL" --format=custom --file="backup-$(date +%Y%m%d-%H%M%S).dump"
```

PGlite 部署不使用 `pg_dump`。先停止唯一访问 `.data/pglite` 的 Platform Node 进程，再对整个 `.data/pglite` 目录做一致性快照或归档；恢复时同样保持 Platform 停止，并恢复到原权限与路径。API Service 不访问该目录。不要在 Platform 写入期间只复制其中单个文件。

备份文件应离开应用服务器保存，避免服务器磁盘故障时同时丢失应用和备份。Redis 只保存可重建缓存、限流计数和短期租约，不作为业务主数据备份来源。

## 恢复演练

恢复到临时数据库验证备份可用：

```bash
createdb openapi_restore_test
pg_restore --dbname=openapi_restore_test --clean --if-exists backup-YYYYMMDD-HHMMSS.dump
```

恢复生产前先停止应用进程，避免旧进程继续写入：

```bash
pm2 stop openapi-platform
DB_AUTO_MIGRATE=false pg_restore --dbname="$DATABASE_URL" --clean --if-exists backup-YYYYMMDD-HHMMSS.dump
cd /path/to/openapi-platform-runtime
pm2 restart openapi-platform --update-env
```

如果迁移不可逆，先判断新 Schema 是否仍兼容旧应用。兼容时可以回滚应用；不兼容时优先使用前向修复，只有在停止全部 Platform 写入后才能恢复发布前备份，不能让旧进程继续写入恢复中的数据库。

## 安全巡检

| 项目 | 要求 |
| --- | --- |
| 管理员密码 | 管理员账号存储在 `users` 表，首次启动生成的随机密码只输出到控制台；首次登录后完成初始化弹窗并定期更新密码 |
| 运行时密钥 | 每个环境独立生成，泄露后立即轮换 |
| Nginx | 只开放必要端口，反向代理到本机 Nitro |
| 数据库 | 不暴露公网，账号只给应用所需权限 |
| API Key | 支持作用域、IP 白名单、配额、有效期和启停控制 |
| 日志 | 不记录 API Key 明文、密码、验证码或完整 token |

## 异常处置

1. 先确认影响范围：首页、统一登录页、管理后台、用户后台、各 Service 的公开接口、数据库、邮件、第三方 OAuth。
2. 冻结变更：暂停发布、停止批量任务、保留日志。
3. 读取 PM2 日志和数据库关键表，定位最近一次配置或代码变更。
4. 如果影响公开 API 收费，检查 `api_credit_reservations` 和 `credit_transactions`。`pending` 可等待后台重试；`dead_letter` 在“积分 → 计费预留”中先核对请求、上游结果和流水，再选择重试、确认扣费或释放。不要直接删除数据库行。
5. 能快速回滚应用时，只回滚异常服务；API Service 回滚不停止 Platform，也不运行 Platform 数据库迁移。涉及 Platform 数据库结构时先备份当前状态。
6. 恢复后补充事件记录：时间线、根因、影响、修复、预防项。

## 性能观察

发布后关注：

- 首页和后台入口的 LCP、CLS、INP。
- 图表页和日志页的交互延迟。
- `.output` bundle 变化，发现大块依赖时按 [Nuxt 应用标准](../standards.md) 分析。
- 第三方脚本和浏览器专属逻辑是否引入水合警告。
- API Service 的 RSS、V8 Heap、Event Loop Delay、请求延迟和 5xx 比例；空闲 RSS 目标不高于 128 MiB，常规峰值不高于 256 MiB。模块只有在出现第二个真实调用方时才抽取共享来源客户端、并发控制或缓存工具。
