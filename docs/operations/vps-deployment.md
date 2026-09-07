# OpenAPI Platform VPS 部署指南

目标生产拓扑包含两个独立 Node.js 应用进程：`openapi-platform` 是 Nuxt/Nitro 管理平台与 Gateway，`openapi-service` 是轻量 Node.js + TypeScript 业务 API 服务。它们独立构建、更新和回滚；统一语言不代表合并进程。数据库可选 PostgreSQL 或 PGlite：PostgreSQL 更适合常规生产和成熟备份，PGlite 仅用于单 Platform 进程的轻量部署。

> Platform 不包含具体公共接口 Handler，所有公开业务流量来自动态 Route。Platform 与 Service 各自在自己的仓库提供部署文件；Platform 仓库的 Compose 只启动 `openapi-platform`。详见[系统概览](../architecture/system-overview.md)和[部署模型](../architecture/deployment.md)。

发布前先完成 [生产就绪清单](./production-readiness.md)，运行时变量按 [运行时配置](./runtime-config.md) 准备。

## 本地或 CI 构建

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm check:dead-code
pnpm test:unit
pnpm build
pnpm test:integration:built
```

构建命令会生成 `.output/package.json` 和 `.output/server/index.mjs`。根级 `package.json` 只提供部署所需的 `start`、`migrate` 脚本，实际入口仍是 Nuxt/Nitro 官方 Node server，不通过自定义启动器包装应用。

不要在生产 VPS 上执行 Platform 的 `pnpm install`、`pnpm build` 或任何仓库的 `docker build`。Nuxt/Nitro 生产构建可能短时间占用 6～8 GB 内存；Platform 和 API Service 都应在 Linux CI 或开发机构建并发布镜像，VPS 只负责拉取和运行。

## 部署入口与目录

Nuxt 官方将完整 `.output` 定义为部署单元，生成目录不应手工修改。Nitro 生成的 `server/package.json` 只描述运行依赖；项目在 `.output/package.json` 生成独立的部署清单，不修改 Nitro 内部文件。

本地或 CI 直接使用构建目录时：

```bash
cd .output
NODE_ENV=production npm run migrate
NODE_ENV=production npm start
```

GitHub Release 会保留版本目录、`LICENSE`、README 和 `.env.example`，但将 `.output` 的内容直接放到版本目录根部。解压后进入该目录执行相同的 `npm run migrate`、`npm start` 即可。不要把工作目录设为 `server`，否则面板读取到的是 Nitro 内部 `package.json`。

必须完整部署运行目录，包括隐藏的 `server/node_modules/.nitro`。不要只上传 `server`，也不要使用会忽略隐藏目录或破坏符号链接的压缩工具。Windows 构建产物含 Junction，跨系统上传容易出现 `Cannot find module 'entities/decode'`；生产优先在 Linux CI 或 Docker 内构建。

## Docker 部署（推荐）

GitHub Actions 使用仓库根目录的 `Dockerfile` 构建完整 Nitro 产物，分别发布带标签的 amd64/arm64 镜像，再生成自动匹配服务器架构的多架构镜像。VPS 只下载和运行已经构建好的镜像，不会执行 `pnpm install` 或 `pnpm build`，因此适合小内存服务器：

```bash
docker network create openapi-network
docker pull ghcr.io/nuoxiantech/openapi-platform:latest
docker run -d --name openapi-platform --restart unless-stopped \
  --network openapi-network \
  -p 3000:3000 --env-file .env \
  -v openapi-data:/app/.data \
  ghcr.io/nuoxiantech/openapi-platform:latest
```

`docker network create` 已存在时会返回错误但不会破坏现有网络；重复部署可先用 `docker network inspect openapi-network` 检查。同机 Service 加入该网络后，Platform 数据库中的 Upstream Target 可以使用 `http://openapi-service:8080`。

启用 IP 归属地接口时，CZDB 数据库必须由服务器单独准备并只读挂载到 `openapi-service`，不能打进任一镜像：

```bash
mkdir -p /var/lib/openapi-service/assets/ip

docker run -d --name openapi-service --restart unless-stopped \
  --network openapi-network \
  -e LISTEN_ADDR=:8080 \
  -e API_SERVICE_TOKEN='replace-with-the-same-platform-service-token' \
  -v /var/lib/openapi-service/assets:/app/data/assets:ro \
  -v openapi-service-runtime:/app/data/runtime \
  ghcr.io/nuoxiantech/openapi-service:latest
```

将 `cz88_public_v4.czdb`、`cz88_public_v6.czdb` 放入宿主机的 `assets/ip`。容器内读取路径固定为 `/app/data/assets/ip`。启动后在 Platform 创建 Upstream，填写与 `API_SERVICE_TOKEN` 相同的 Token，执行发现，再在通用配置表单填写 `ip.databaseKey`。Platform 与 Service 快照都只保存密文，读取接口不回显密钥。

Platform 仓库提供只包含 Platform 的 `docker-compose.yml`：

```bash
docker compose pull
docker compose up -d
```

Service 仓库另有自己的 Compose 和完整部署文档。两个仓库可以放在不同目录、使用各自 `.env`，并共同加入 `openapi-network`。仅更新一言、播放器、IP 或其他具体公共接口时，在 Service 部署目录执行：

```bash
docker compose pull openapi-service
docker compose up -d --no-deps openapi-service
docker compose ps openapi-service
```

该操作只更新目标 Service，Platform、Console、管理 API 和其他 Service 的接口可继续工作。单实例 API Service 切换期间，指向它的 Route 可能短暂返回 `503 Service Unavailable`；Gateway 应附带 `Retry-After`、快速结束请求且不扣费，不能让连接排队数分钟。需要近零停机时，先启动新 Target，通过发现校验后发布 Routing Revision，再排空旧 Target。

仅更新 Platform 时也不重建 API Service：

```bash
docker compose pull openapi-platform
docker compose stop openapi-platform
docker compose run --rm --no-deps openapi-platform node server/migrate.mjs
docker compose up -d --no-deps openapi-platform
```

停止 Platform 是适用于 PGlite 和破坏性 Schema 变更的安全默认流程。使用 PostgreSQL 且迁移已经确认向后兼容时，可以在旧实例继续服务期间先运行一次性迁移容器，再滚动替换；具体约束见[数据库迁移与版本升级](./database-migrations.md)。

使用 Service Compose 启用 IP 归属地接口时，在 Service `docker-compose.yml` 同目录准备数据：

```bash
mkdir -p data/assets/ip
# 将 cz88_public_v4.czdb、cz88_public_v6.czdb 放入 data/assets/ip
```

Service Compose 会把 `./data/assets` 只读挂载到 `/app/data/assets`，并为 `/app/data/runtime` 创建可写持久化 Volume。启动后在 Platform 保存 `ip.databaseKey`；该业务 Secret 不通过环境变量注入。

`main` 分支发布 `latest`、`latest-amd64` 和 `latest-arm64`，用于跟踪开发版本。符合 `v*.*.*` 格式的 Git 标签会生成去掉 `v` 前缀的版本镜像及架构标签。生产环境建议固定版本标签或镜像 digest，升级时修改镜像版本后重新执行上述两个 Compose 命令。若 GHCR 包不是公开的，需要先用具有 `read:packages` 权限的 GitHub PAT 登录：

```bash
echo "$GHCR_TOKEN" | docker login ghcr.io -u YOUR_GITHUB_USER --password-stdin
```

Platform 镜像直接执行 `node server/index.mjs`；它与根级 `package.json` 的 `start` 脚本使用同一个官方入口。目标 API Service 镜像直接运行预编译的 `dist/index.js`，不执行 TypeScript 或 Nuxt 构建。生产数据库和 Redis 地址仍只注入 Platform；使用 PGlite 时必须保留 `/app/.data` 数据卷。

## 上传文件

GitHub Release 压缩包解压后的结构如下，`.output` 不再作为中间目录：

```text
openapi-platform-<version>/
├── package.json
├── public/
├── server/
├── .env.example
├── LICENSE
├── README.md
└── README_ZH.md
```

进入解压目录后先迁移，成功后再启动：

```bash
cd openapi-platform-<version>
NODE_ENV=production npm run migrate
NODE_ENV=production npm start
```

直接上传本地构建的 `.output` 时，则把 `.output` 本身作为工作目录，命令保持相同。

## 服务器环境变量

在服务器面板或进程管理器中配置以下变量：

```bash
NITRO_PORT=3000
NITRO_HOST=127.0.0.1
NODE_ENV=production
TZ=Asia/Shanghai

# PostgreSQL 配置；留空或删除该变量则自动使用 PGlite：
DATABASE_URL=postgresql://user:password@127.0.0.1:5432/openapi

NUXT_AUTH_SECRET=change-me
NUXT_API_KEY_SECRET=change-me

# 单层本机 Nginx 示例：
NUXT_PROXY_SOURCE=x_forwarded_for
NUXT_PROXY_TRUSTED_CIDRS=127.0.0.1/32,::1/128
NUXT_PROXY_FORWARDED_HOPS=1

# Redis 分布式限流与公开短缓存（推荐正式生产启用）
NUXT_REDIS_URL=redis://127.0.0.1:6379
```

生产环境没有 `DATABASE_URL` 时会自动使用 PGlite。PGlite 始终使用当前工作目录下的 `.data/pglite`，该目录必须保持持久化并纳入服务器备份。首次创建管理员时，服务端日志只会输出一次随机初始密码；应立即登录并完成资料和密码初始化。

IP 数据文件只属于 Service，不要挂载到 Platform 的 PM2 进程。`ip.databaseKey` 由 Platform 以 Service 业务 Secret 的形式分域加密保存。Service 统一从 `SERVICE_DATA_DIR/assets/ip` 读取数据库，并把加密配置快照固定写入 `SERVICE_DATA_DIR/runtime`。

生产密钥可用以下命令生成：

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Redis 应仅监听本机或私有网络，并启用认证或 TLS。限流计数、业务缓存和分布式租约均有 TTL，少量缓存版本 key 持久存在；建议使用 `maxmemory-policy noeviction` 并监控内存、命中率、淘汰数与命令延迟，避免关键限流或租约 key 被提前淘汰。Redis 未配置时应用继续使用单进程内存限流、短缓存和本地任务互斥；配置 `NUXT_REDIS_URL` 后 Redis 故障会 fail-closed。缓存命令故障仍会安全回源数据库。

## 启动

首次部署或升级时先使用同一份构建产物执行迁移，再启动应用进程：

```bash
cd /path/to/openapi-platform-runtime
NODE_ENV=production npm run migrate
NODE_ENV=production npm start
```

启动插件会在 Nitro 接受请求前使用同一执行器幂等复查。迁移执行器根据运行时配置连接 PostgreSQL 或 PGlite，并使用 Drizzle 的 `drizzle.__drizzle_migrations` 表，因此已经应用过的迁移会自动跳过。维护窗口需要临时禁止自动迁移时，可设置 `DB_AUTO_MIGRATE=false`。

当前开发线使用破坏性重建后的唯一 `0000` 基线。旧 `0.1.0`、`0.1.1` 数据库和 PGlite Volume 不能原地升级；部署包含新基线的版本前必须停止 Platform、完成备份并重建数据库，必要数据通过经过验证的导出/导入流程迁移。

发布含账号、OAuth、通知、积分或日志 Schema 变更的版本前，只修改 `server/db/schema/`，再用 `pnpm db:generate --name descriptive_name` 生成并随版本发布数据库迁移；禁止手工编辑 SQL、snapshot 或 journal。当前账号模型要求管理员和用户共用 `users` 表，并通过 `users.role` 区分权限。

## 进程管理建议

PM2 是最简单的选择：

```bash
cd /path/to/openapi-platform-runtime
NODE_ENV=production pm2 start server/index.mjs --name openapi-platform --update-env
pm2 save
```

发布新版本时：

```bash
cd /path/to/openapi-platform-runtime
pm2 restart openapi-platform --update-env
```

建议在 Node 进程前放置 Nginx，并反向代理到 `127.0.0.1:3000`。

不要让多个 Platform Node 进程访问同一个 PGlite 数据目录。Platform 需要横向扩展时必须切换 PostgreSQL，并配置共享 `NUXT_REDIS_URL`。API Service 是另一个 Node 进程，但不访问 PGlite、PostgreSQL 或 Redis；它可以通过多个 Upstream Target 独立扩容。限流、缓存和扣费补偿扫描由 Platform 的 Redis 协调；Routing Revision 依靠数据库唯一约束与事务保持一致，PostgreSQL 迁移由 advisory lock 串行化。

## 发布后检查

```bash
curl -fsS http://127.0.0.1:3000/api/health
curl -fsS http://127.0.0.1:3000/api/ready
curl -fsS http://127.0.0.1:3000/api/catalog
docker compose ps openapi-platform
pm2 logs openapi-platform --lines 80
```

只执行与实际部署方式对应的 Compose 或 PM2 检查。Service 在自己的部署目录执行 `docker compose ps`，或直接使用 `curl -fsS http://127.0.0.1:8080/healthz` 和 `/readyz`。

确认统一登录页、管理员后台、用户后台、动态 Route 调用、详细调用日志和积分流水均可用后，再按 [生产运行手册](./production-runbook.md) 观察日志和关键表，最后把发布标记为完成。正式版本范围以 [版本与支持范围](../architecture/release-scope.md) 为准。
