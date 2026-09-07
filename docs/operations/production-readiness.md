# 生产就绪清单

本清单用于发布 OpenAPI 到生产环境前的最终确认。目标部署包含独立的 Node Platform 与 Node API Service。单 Platform 实例可使用 PostgreSQL 或显式配置的 PGlite；多 Platform 实例必须使用 PostgreSQL 和共享 Redis。API Service 不连接 Platform 数据库或 Redis。

## 发布前门禁

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm check:dead-code
pnpm test:unit
pnpm build
pnpm test:integration:built
```

失败即停止发布。涉及公开 API、积分、鉴权、数据库 schema 或后台统计时，测试必须覆盖核心分支；暂未覆盖的风险要写进发布说明。

当前 Node API Service 的独立仓库至少执行：

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
```

两组命令都只在开发机或 CI 执行。生产服务器不安装依赖、不执行 Nuxt/TypeScript Build，也不构建镜像。

## 配置核验

| 项目 | 检查 |
| --- | --- |
| 数据库 | PostgreSQL：`DATABASE_URL` 指向生产库，账号权限满足迁移和运行；PGlite：不配置 `DATABASE_URL`，并确认 `.data/pglite` 是持久化目录 |
| 数据库迁移 | 当前唯一 `0000` 是破坏性重建基线；旧数据库不得原地升级。确认 SQL、snapshot 和 journal 均由 Drizzle 从当前 Schema 生成、没有手工编辑，已完成备份与重建计划，并确认 `.output/server/migrate.mjs` 与对应 SQL 同时进入产物 |
| 运行时密钥 | `NUXT_AUTH_SECRET`、`NUXT_API_KEY_SECRET` 已独立生成并完成安全备份；每个 Upstream 使用独立 Service Token，并确认数据库中只保存密文 |
| Platform 入口 | Console、站内 API 和动态 Gateway 共用一个入口；反向代理只将预期域名转发到 Nitro，公共 Route 不占用 Platform 保留路径 |
| Redis | 使用共享限流、短缓存和任务协调时配置 `NUXT_REDIS_URL`；配置后 Redis 不可用会 fail-closed，多实例必须配置 |
| 管理员账号 | 首次启动时从受控服务端日志读取一次性随机初始密码，立即登录并完成不可跳过的密码轮换；用户名与邮箱可保留默认，但默认邮箱域名不可达，保留即意味着该账号无法接收密码重置邮件 |
| 网络 | Nitro 监听 `127.0.0.1:<port>`，公网由 Nginx 或等价代理接入；按实际拓扑配置可信代理 CIDR 和转发层数 |
| API Service | `openapi-service` 是独立 Node 进程，只连接内部网络且不映射公网业务端口；Upstream 使用 `http://openapi-service:8080` 或等价私网地址 |
| API Service 资源 | 容器空闲 RSS 不高于 128 MiB、常规业务测试峰值不高于 256 MiB、启动到 ready 不高于 2 秒；缓存和来源并发均有上限 |
| API Key 数据 | 确认普通列表仅返回掩码预览，只有 Key 所有者可按需查看完整值且查看行为写入操作日志；`NUXT_API_KEY_SECRET` 与数据库备份分开保存，明文不进入操作日志或普通应用日志 |
| 主密钥边界 | 已确认 `0.1.0` 不支持 `NUXT_API_KEY_SECRET` 在线轮换；现有数据库不得直接替换该值 |
| 部署产物 | Platform 构建完整 `.output`，并将其内容扁平化到 Release 版本目录根部；根级 `package.json` 提供 `start`、`migrate`，且不能遗漏 `server/node_modules/.nitro`。API Service 独立发布预编译 `dist` |
| 时区 | `TZ=Asia/Shanghai`；启动迁移会将数据库迁移会话设置为同一时区，数据库默认时区无需额外修改 |
| 备份 | PostgreSQL 有数据库备份或可恢复快照；PGlite 已备份 `.data/pglite` |
| 审计降级采集 | stderr 已被日志采集抓取并按备份同等周期保留，且已对 `AUDIT_FALLBACK` 标记建立告警；未配置时审计写入失败即等于记录丢失，详见 [生产运行手册](./production-runbook.md) |
| 巡检 | 发布负责人已阅读 [生产运行手册](./production-runbook.md) 的回滚和异常处置 |

完整变量见 [运行时配置](./runtime-config.md)。

## 发布步骤

1. 在本地或 CI 运行对应仓库的发布前门禁，生产服务器不执行任何构建。
2. 设置或确认运行时环境变量。
3. 上传完整 Platform `.output`，或上传已将其内容扁平化的 GitHub Release 版本目录；API Service 使用自己的 `dist` 或镜像。
4. Platform 发生变化时先备份数据库，再使用新产物的 `migrate.mjs` 显式应用迁移；成功后才切换应用。启动时的自动迁移保留为幂等安全检查。
5. 只更新发生变更的服务。API Service 更新不运行 Platform 数据库迁移，也不停止 Platform。
6. 执行健康检查和关键路径冒烟。

## 健康检查

```bash
curl -fsS http://127.0.0.1:3000/api/health
curl -fsS http://127.0.0.1:3000/api/ready
curl -fsS http://127.0.0.1:3000/api/catalog
docker compose ps openapi-platform openapi-service
docker compose exec -T openapi-service node -e "fetch('http://127.0.0.1:8080/healthz').then(r=>{if(!r.ok)process.exit(1)})"
docker compose exec -T openapi-service node -e "fetch('http://127.0.0.1:8080/readyz').then(r=>{if(!r.ok)process.exit(1)})"
```

如果 API Service 不是 Compose 容器而是直接运行的 PM2/Node 进程，则改用 `curl -fsS http://127.0.0.1:8080/healthz` 和 `/readyz`。

随后人工验证：

- 首页可打开，首屏无明显布局跳动。
- 管理员可通过统一 `/login` 登录并进入后台；用户仍只能看到用户工作区。
- 用户登录、API Key 列表、公开 API 列表可用。
- 一个低风险动态 Route 可被 API Key 调用，详细调用日志和积分流水写入正常。Route 维度每日聚合必须按 [版本与支持范围](../architecture/release-scope.md) 验收，不能用兼容聚合数据代替。
- API Service 的 `/healthz`、`/readyz`、OpenAPI 和受 Service Token 保护的测试 Route 可用。
- PM2 日志无鉴权密钥错误、数据库连接错误或 `[db:migrate]` 失败记录。
- `api_credit_reservations` 没有积压的 `pending` 或 `dead_letter`，调用日志和积分流水符合预期。
- 静态资源在 `Accept-Encoding: br, gzip` 下返回 `Content-Encoding: br` 或 `gzip`。
- HTML 响应包含 CSP、HSTS、`X-Content-Type-Options`、Referrer Policy 和 Permissions Policy。

## Web Vitals 基线

发布后至少抽查首页、公开 API 列表页、用户后台和管理后台入口：

| 指标 | 目标 | 优化方向 |
| --- | --- | --- |
| LCP | 小于 2.5s | 保持首屏 SSR，减少阻塞资源，优化首屏图片尺寸和格式 |
| CLS | 小于 0.1 | 图片、图表、表格和统计卡声明稳定尺寸 |
| INP | 小于 200ms | 长列表分页，重图表懒加载，减少 hydration 阶段插件工作 |

可使用 Lighthouse、Chrome Performance 面板、PageSpeed Insights 或 WebPageTest。发现大 bundle 时使用 Nuxt analyze 定位依赖，再按 [Nuxt 应用标准](../standards.md) 拆分。

## 回滚策略

- 保留上一版完整运行目录和对应环境变量。
- 保留两个应用各自的上一稳定镜像 digest；只回滚异常服务，不默认同时重启另一服务。
- 数据库迁移由新产物在切流前显式执行，启动时再幂等检查；发布前先备份 PostgreSQL 或 PGlite 数据目录。如果迁移不可逆，发布说明必须写清业务回滚路径。
- 应用层回滚优先切换 PM2 指向上一版目录，再执行健康检查。

```bash
pm2 stop openapi-platform
cd /path/to/previous/openapi-platform-runtime
NODE_ENV=production pm2 start server/index.mjs --name openapi-platform --update-env
pm2 save
```

## 运行期观察

| 观察项 | 异常信号 |
| --- | --- |
| PM2 日志 | 迁移失败、数据库连接失败、未配置 JWT secret |
| 数据库 | `api_credit_reservations` 中 `pending` 持续增长、出现 `dead_letter`，或 PGlite 数据目录磁盘空间不足 |
| API 网关 | 401/403/429 异常升高 |
| 资源 | CPU、内存、连接数持续接近上限 |
| 前端 | Lighthouse 分数下降，LCP/CLS/INP 超过目标 |
