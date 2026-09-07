# 运行时配置

本项目按 Nuxt 官方 runtimeConfig 范式管理生产配置。生产密钥只允许在运行时通过环境变量注入，不允许写入源码、文档、镜像层或构建产物。

## 基本原则

- `nuxt.config.ts` 中的私有配置默认值保持空字符串。
- 生产环境使用 `NUXT_AUTH_*`、`DATABASE_URL`、`NITRO_*` 等变量覆盖。
- 不在 `nuxt.config.ts` 默认值中读取异名 `process.env`，避免构建时把密钥烤进 `.output`。
- `.env.example` 只能放示例值；真实生产值配置在服务器面板、PM2 ecosystem、容器 secret 或 CI/CD secret 中。
- 修改 Platform 部署配置后只重启 Node/Nitro Platform 进程。API Service 的 Token、监听地址、统一数据目录和网络配置属于 Service 仓库与部署环境；Service 声明的模块开关、Cookie、数据库授权密钥和算法列表由后台热更新，不要求重启。两个进程不能因为统一使用 Node.js 而共用环境变量命名空间。

`.env.example` 只保留首次正常启动需要选择或填写的变量。监听端口、连接池、迁移开关、Redis 高级选项和可信代理等覆盖项继续受支持，但只在本页说明，不把每个可调参数都塞进模板。启动阶段会集中校验必填配置；如果存在多项错误，会一次性列出全部错误并停止进程。

## 必填变量

| 变量 | 生产要求 | 说明 |
| --- | --- | --- |
| `NUXT_AUTH_SECRET` | 必填 | access JWT、邮箱验证、一次性 token 与 OAuth state 共用的 HS256/HMAC 签名密钥，缺失时鉴权应 fail-closed |
| `NUXT_API_KEY_SECRET` | 必填 | 用于生成 API Key，并派生 API Key/兑换码的 HMAC 查询摘要与 AES-256-GCM 加密密钥 |

## 推荐变量

| 变量 | 推荐值 | 说明 |
| --- | --- | --- |
| `NITRO_HOST` | `127.0.0.1` | VPS + Nginx 反向代理时只监听本机 |
| `NITRO_PORT` | `3000` | Nitro 服务端口 |
| `NODE_ENV` | `production` | 让 Nuxt、Vue Router 和相关依赖使用生产分支，减少开发警告和日志噪声 |
| `TZ` | `Asia/Shanghai` | 统一日志、统计、运维时间以及数据库迁移中的自然日转换 |
| `DATABASE_POOL_SIZE` | `10` | `postgres-js` 连接池上限，启动迁移会单独使用 `max=1` 的连接 |
| `DATABASE_URL` | 留空 | 非空时使用 PostgreSQL；留空或未配置时自动使用固定目录 `.data/pglite` |
| `DB_AUTO_MIGRATE` | 留空 | 默认启动时自动迁移；设置为 `false` 可临时跳过启动迁移 |
| `MIGRATIONS_DIR` | 留空 | 仅迁移目录不在构建产物默认位置时设置；显式迁移和启动自动迁移共用该覆盖项 |
| `NUXT_REDIS_URL` | 留空 | Redis 连接地址；配置后启用共享原子限流、公开短缓存和分布式协调，并在 Redis 不可用时 fail-closed |
| `NUXT_REDIS_KEY_PREFIX` | `openapi:` | Redis key 命名空间；同一 Redis 服务部署多个环境时必须区分 |
| `NUXT_REDIS_CONNECT_TIMEOUT_MS` | `2000` | Redis 首次连接超时毫秒数 |
| `NUXT_PROXY_SOURCE` | 留空 | 留空时由管理后台配置；可设 `direct`、`cloudflare`、`x_forwarded_for`。一旦设置，环境变量优先并锁定后台对应表单 |
| `NUXT_PROXY_TRUSTED_CIDRS` | 留空 | 允许提供客户端 IP 与公网协议转发头的直连代理 IP/CIDR，多个值用逗号分隔；支持 IPv4、IPv6、`0.0.0.0/0` 与 `::/0` |
| `NUXT_PROXY_FORWARDED_HOPS` | `1` | 从 `X-Forwarded-For` 右侧计算的可信代理层数，最多 10 层 |

生产如果前面有 Nginx、Caddy 或面板反向代理，应设置 `NITRO_HOST=127.0.0.1`，避免 Nitro 直接暴露到公网；容器部署可以使用镜像或 Compose 提供的监听默认值。

Platform 使用一个访问地址同时提供 Console、站内 API 和动态 Gateway。`/api`、`/_nuxt`、`/_i18n`、`/admin`、`/user`、登录与公开页面等 Platform 路径固定保留，不能被公共 Route 覆盖；其中 `/_i18n` 是 Nuxt i18n 的语言包端点，必须由 Nitro 处理。其他路径交给动态 Gateway 匹配。对公网允许哪些域名访问由 Nginx、Caddy 或云平台入口负责，不再通过 Platform 环境变量重复配置。

多个 Service 的地址、Token、权重与轮询策略统一保存在 Platform 数据库的 Upstream/Target 中，与 Platform 的访问域名无关。

PostgreSQL 连接串使用标准 URI：

```dotenv
DATABASE_URL=postgresql://openapi:change-me@127.0.0.1:5432/openapi?sslmode=disable
```

托管数据库通常要求 `sslmode=require`。用户名或密码中的 `@`、`:`、`/`、`#`、`?` 等保留字符必须进行百分号编码。不配置 `DATABASE_URL` 即使用 PGlite，不需要额外的数据库类型变量。

Redis 连接串同样使用 URI；有密码时建议明确写出 ACL 用户名，Redis 默认用户为 `default`：

```dotenv
NUXT_REDIS_URL=redis://default:change-me@127.0.0.1:6379/0
```

末尾 `/0` 是 Redis 逻辑数据库编号。启用 TLS 时使用 `rediss://`。无认证的本机 Redis 可写为 `redis://127.0.0.1:6379/0`。连接串中的用户名和密码也必须进行百分号编码。

Redis 当前用于公开 API 限流、登录/注册/密码重置/OAuth 身份防刷，公开统计与内容短缓存，以及扣费补偿扫描的分布式互斥。限流 key 使用 HMAC 摘要，不会把邮箱、账号或 IP 明文写入 Redis；站点 SMTP、OAuth、Turnstile 密钥、用户私有响应、积分与调用日志不会进入共享缓存。

缓存采用 cache-aside、TTL 抖动、进程内请求合并和 Redis 短锁；管理端写入后立即删除固定缓存或递增版本。Redis 未配置或缓存命令失败时自动回源数据库，不会让公开页面变成 503。Gateway Target 的短期失败/驱逐状态也写入带 TTL 的 Redis，并由带租约的探测任务跨实例共享；未配置 Redis 时回退当前进程状态。扣费扫描使用带 token 校验和固定 TTL 的最小 Redis lease；未配置 Redis 时回退当前进程互斥，配置 Redis 后租约故障会跳过任务，避免多实例重复调度。

单 Platform 实例开发可以不配置 Redis。多个 Platform Node 实例的生产部署必须使用 PostgreSQL 并配置 `NUXT_REDIS_URL`；只要配置了 Redis，限流和分布式协调在 Redis 不可用时都会 fail-closed，避免回退到各自内存后绕过限制。PGlite 数据目录只允许一个 Platform 进程。API Service 不连接 Platform 的 PostgreSQL 或 Redis。PostgreSQL 迁移另有数据库 advisory lock，即使多个 Platform 实例同时启动也会串行执行。

`openapi-service` 的地址不是全局环境变量，而是 Platform 数据库中的 Upstream Target，例如共享 Docker 私网中的 `http://openapi-service:8080`。同一 Upstream 可保存多个 Target，并使用轮询或权重分流。

Platform 不读取全局 API Service Token。每个 Upstream 在数据库中独立加密保存 Token，Gateway 按匹配到的 Upstream 解密并注入 `Authorization: Service <token>`。

Platform 仓库的 `.env` 和 Compose 都不包含全局 Service Token，也不负责启动任何 Service。管理员在创建 Upstream 时填写目标 Service 自己的 `API_SERVICE_TOKEN`；之后 Platform 只使用数据库密文。多个 Upstream 可以使用不同 Token。

Node API Service 的部署配置包含 `API_SERVICE_TOKEN`、独立的 `SERVICE_CONFIG_KEY`、稳定的 `SERVICE_ID` / `SERVICE_NAME`，以及可选的 `LISTEN_ADDR` 和统一 `SERVICE_DATA_DIR`。`SERVICE_CONFIG_KEY` 只加密该实例的本地配置快照，不能与 Token 复用；Token 只负责请求认证。某个业务模块需要的来源地址、Cookie、数据库授权密钥或算法开关必须由该模块的 Service Schema 声明；不能提交仓库的数据文件固定由 Service 从 `SERVICE_DATA_DIR/assets/<module-id>` 读取。它们都不进入 Platform 的 `.env.example`。API Service 不使用 `NUXT_*` 业务变量，也不读取 Platform 数据库。

两个仓库的构建变量与运行变量必须分离。CI 或开发机完成 Nuxt 与 TypeScript 构建后生成镜像；生产服务器只注入运行时变量并启动镜像，不执行 `pnpm install`、`pnpm build` 或 `docker build`。

管理员账号与用户共用 `users` 表，通过 `users.role='admin'` 区分，并统一从 `/login` 登录。启动时如果不存在任何管理员账号，服务端会创建默认管理员并仅输出一次随机初始密码。管理员登录后必须完成不可关闭的资料和密码初始化。

首次登录后，如果管理员仍使用初始用户名或邮箱，系统会显示一次初始化弹窗，用于确认用户名、邮箱并强制设置新密码。后续用户名不再作为常规资料项修改，以保证登录日志、操作日志和审计链路稳定。

当前开发线已破坏性重建为唯一的 `0000` 完整基线。旧 `0.1.0`、`0.1.1` 数据库或 PGlite Volume 不能原地升级到包含该基线的版本，必须重建数据库或执行经过验证的数据导出/导入。新基线正式发布后才恢复只追加增量迁移的规则。

构建产物同时包含 `.output/package.json`、`.output/server/migrate.mjs` 和 `.output/server/db/migrations/postgresql`。以 `.output` 或解压后的 GitHub Release 根目录作为工作目录，生产机可以在启动新版本前执行 `npm run migrate`，再用 `npm start` 启动；启动插件仍会幂等复查。`pnpm db:migrate` 只用于源码工作区，不能作为纯构建产物的生产入口。PGlite 使用同一套 PostgreSQL 方言迁移。完整流程见[数据库迁移与版本升级](./database-migrations.md)。

数据库建议：

- PostgreSQL 适合常规生产、远程数据库、成熟备份和未来扩展。
- PGlite 适合单进程、低运维成本、自包含的小型部署；它不是多实例共享数据库，固定使用 `.data/pglite`，生产时必须备份该目录。
- 未配置 `DATABASE_URL` 时自动使用 PGlite；生产部署必须确认 `.data/pglite` 已挂载到预期的持久化存储并纳入备份。

## 密钥生成

每个密钥单独生成，不要和其他系统复用：

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

`NUXT_AUTH_SECRET` 和 `NUXT_API_KEY_SECRET` 使用独立的 32 bytes 随机值；每个 Upstream 的 Service Token 也必须单独生成，至少 32 个随机字符，不与前两者复用。每个 Service 实例还必须生成独立的 32-byte `SERVICE_CONFIG_KEY`，并与对应运行快照一起备份。Service Token 只在 Service 部署环境和对应 Platform Upstream 中分别配置。Platform 修改 Token 时先保留待验证版本，发现成功后才提升为活动凭证；验证失败时已发布流量继续使用上一个已验证版本。`NUXT_AUTH_SECRET` 泄露后应在维护窗口轮换，并预期现有登录态、验证链接与 OAuth state 失效。

Service Token 更新会持久化为待验证版本；Platform 先用该版本执行发现，成功后原子提升为活动凭证，失败时保留旧凭证服务已发布流量。在线更换时保持 `SERVICE_CONFIG_KEY` 不变，在 Service 的 `API_SERVICE_PREVIOUS_TOKEN` 中短暂保留旧值，再把新 Token 写入 Service 与 Platform；提升完成后立即删除旧值。配置快照不使用 Token 加密，因此 Token 轮换不会使已有快照失效。Token 不匹配时连接状态不会显示为在线，公开调用中的明确 Service 鉴权失败会由 Gateway 转换为 `502 UPSTREAM_AUTH_FAILED`。

API Key 和兑换码没有裸明文数据库列。数据库保存带密钥的 HMAC 摘要、随机 IV 的 AES-256-GCM 密文和掩码预览；API Key 所有者和管理员均可通过各自的专用接口按需查看完整值，每次查看都会写入不含明文的操作日志。普通列表、历史记录、操作日志和积分流水始终只返回预览。

API Key 与兑换码可恢复且可重复查看是明确的产品要求，不是过渡实现。`/api/user/apikeys/reveal` 允许已认证的 Key 所有者解密自己的完整 Key；`/api/admin/redemption-codes/reveal` 允许管理员解密指定兑换码。数据库中的摘要用于鉴权或精确查询，密文用于恢复能力。后续重构不得在没有明确产品决策和数据迁移方案的情况下，把它们改成只在创建时显示一次或删除密文列。

### `NUXT_API_KEY_SECRET` 轮换边界

`NUXT_API_KEY_SECRET` 是 Platform 长期数据加密根，不是应定期在线轮换的短期 Token。它必须与数据库备份一起纳入备份、恢复演练和访问控制。`0.1.0` 不提供 Keyring、双主密钥读取或在线重加密流程，因此不能在已有数据库上直接替换该值；直接替换会让 API Key/兑换码密文、Upstream Token 和 Service 业务 Secret 无法解密，并使现有 API Key 摘要无法匹配。

系统设置使用独立数据密钥格式 `enc:system-setting:v2:`；升级时不兼容旧密文，必须在迁移前备份并重新保存敏感配置。

常规维护只需安全备份并保持该值稳定。只有密钥泄露或执行经过演练的数据迁移时才进行轮换：先停止 Platform 写入，备份数据库，使用专用迁移流程以旧密钥解密并以新密钥重加密/重建摘要，再原子切换应用配置。该迁移工具不属于 `0.1.0`；在工具完成前，不得把直接修改环境变量当作轮换方案。Service Token 的维护流程由 Service 仓库定义，与 Platform 主数据密钥轮换无关。

## PM2 示例

以下 `/path/to/openapi-platform-runtime` 可以是本地构建的 `.output`，也可以是 GitHub Release 解压后的版本目录。

```bash
cd /path/to/openapi-platform-runtime
NITRO_HOST=127.0.0.1 \
NITRO_PORT=3000 \
NODE_ENV=production \
TZ=Asia/Shanghai \
DATABASE_URL='postgresql://user:password@127.0.0.1:5432/openapi' \
NUXT_REDIS_URL='redis://127.0.0.1:6379' \
NUXT_AUTH_SECRET='replace-with-random-hex' \
NUXT_API_KEY_SECRET='replace-with-random-hex' \
pm2 start server/index.mjs --name openapi-platform --update-env
```

PGlite 生产示例：

```bash
cd /path/to/openapi-platform-runtime
NITRO_HOST=127.0.0.1 \
NITRO_PORT=3000 \
NODE_ENV=production \
TZ=Asia/Shanghai \
NUXT_AUTH_SECRET='replace-with-random-hex' \
NUXT_API_KEY_SECRET='replace-with-random-hex' \
pm2 start server/index.mjs --name openapi-platform --update-env
```

## 风险清单

| 风险 | 处理方式 |
| --- | --- |
| 构建机 `.env` 泄露到产物 | 不在 runtimeConfig 默认值读取异名 `process.env` |
| 多环境共用密钥 | 每个环境独立生成并独立轮换 |
| 直接替换 `NUXT_API_KEY_SECRET` | `0.1.0` 不支持在线轮换；保持原值，或在停写、备份和专用重加密迁移下更换 |
| Upstream Token 泄露 | 按 Service 文档进入维护窗口，保持 `SERVICE_CONFIG_KEY` 不变，替换 Service Token，再在对应 Upstream 更新加密 Token 并重新发现、同步配置 |
| 生产监听公网端口 | `NITRO_HOST=127.0.0.1`，由 Nginx 代理公网流量 |
| 数据库迁移误连 | PostgreSQL 发布前确认 `DATABASE_URL` 的主机、库名和用户；PGlite 发布前确认当前工作目录下的固定 `.data/pglite` |
| 自动迁移误执行 | 维护窗口可临时设置 `DB_AUTO_MIGRATE=false`，手动确认后再恢复默认 |
| Redis 故障后限流失效 | 配置 `NUXT_REDIS_URL` 后应用会 fail-closed，并监控 `/api/ready` |
| Redis 故障后后台任务重复 | 配置 `NUXT_REDIS_URL` 后租约不可用时任务 fail-closed |
| Redis 缓存命中率下降 | 检查 Redis 延迟、内存和淘汰统计；应用会回源数据库，但数据库负载会升高 |
| 数据库或备份泄露 API Key | 数据库字段已使用 AES-256-GCM 加密；仍需隔离应用运行密钥并限制数据库、备份和服务端权限 |
| 伪造客户端 IP 请求头 | 优先使用后台的直连模式；启用 Cloudflare/XFF 时仅配置真实直连代理，避免使用 `0.0.0.0/0` 或 `::/0`，并阻止绕过代理直连源站 |
| 环境变量配置变更未生效 | 使用 `pm2 restart openapi-platform --update-env` 或等价重启命令；后台数据库配置无需重启 |
