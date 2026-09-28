# 本地启动与诊断

## 首次运行

安装 Node.js 24 和项目指定版本 pnpm，在源码目录安装依赖并填写自己的配置：

```bash
pnpm install --frozen-lockfile
cp .env.example .env
# 填写 NUXT_AUTH_SECRET、NUXT_API_KEY_SECRET 及所需连接地址
pnpm dev
```

配置和密钥由部署者管理。所有启动与诊断命令只读取和校验，不生成密钥，也不创建或修改 `.env`。构建不需要这些运行配置。

Node.js、pnpm、依赖安装与基础配置均手动完成；项目脚本不下载或安装工具，也不自动安装依赖。`package.json` 中的 `engines` 和 `packageManager` 只声明项目要求。

## 常用命令

| 命令 | 行为 |
| --- | --- |
| `pnpm dev` | 原生 `nuxt dev`，读取开发环境配置并运行 HMR 服务器 |
| `pnpm dev --port 3001` | 指定开发端口 |
| `pnpm build` | 纯构建；不迁移、不启动、不要求运行密钥或在线数据库 |
| `pnpm preview` | 原生 `nuxt preview`，本地预览现有构建，按 Nuxt 规则读取 `.env` |
| `pnpm start` | 项目配置加载与检查后运行 Nitro 官方入口；缺少构建时提示先运行 `pnpm build` |
| `pnpm db:migrate` | 使用同一配置和数据目录显式迁移 |
| `pnpm run doctor` | 诊断版本、依赖、配置、数据目录、数据库/Redis 和就绪状态 |
| `pnpm run doctor --json` | 机器可读诊断，错误退出码为 1 |

启动命令不会自动构建。首次启动仍自动迁移并创建管理员，初始化账号信息在首次启动日志中显示；以 `/api/ready` 返回成功为就绪依据。

## 配置与数据路径

项目的 `start`、迁移和诊断命令从脚本所在项目定位根目录。本地 `.output` 仍关联源码根目录，进入 `.output` 执行 `npm start` 不会创建另一份数据库。独立发布包从自己的根目录读取 `.env`。Nuxt 原生 `dev` 和 `preview` 使用 Nuxt 的项目根目录与 `--dotenv` 规则。

配置优先级为：进程环境变量覆盖配置文件；没有配置的值使用默认值。空环境变量也是明确覆盖。默认只读取根目录 `.env`，不会向任意祖先目录搜索配置。

`PLATFORM_ENV_FILE` 为项目的 `start`、迁移和诊断命令指定其他文件，建议使用绝对路径；显式指定的文件不存在时直接报错。原生 Nuxt 命令选择其他配置文件时使用 `--dotenv`。`PLATFORM_DATA_DIR` 是数据根目录，PGlite 实际位于其 `pglite` 子目录；默认 `.data`。项目脚本的相对路径基于配置文件目录，原生 Nuxt/Node 入口的相对路径基于工作目录；跨入口部署建议显式配置绝对路径。

```dotenv
PLATFORM_DATA_DIR=/var/lib/openapi-platform
NITRO_HOST=127.0.0.1
NITRO_PORT=3000
```

升级发布目录时保持 `PLATFORM_ENV_FILE` 和 `PLATFORM_DATA_DIR` 指向稳定位置，并备份配置与数据库。如果旧版本曾把配置放进 `.output/.env` 或把数据放进 `.output/.data`，新命令会停止并要求明确选择配置或数据目录，不自动复制、覆盖或放弃旧数据。应停机备份后将其恢复到构建目录外的持久化位置。

## 发布包与直接 Node 入口

完整 `.output` 或 Release 解压目录提供：

```bash
npm start
npm run migrate
npm run doctor
```

这些命令使用薄启动脚本加载配置并检查运行环境，实际服务仍由 Nitro 官方 `server/index.mjs` 执行。无需源码、pnpm 或开发依赖。

Nuxt 官方生产入口为 `NODE_ENV=production node .output/server/index.mjs`，生产环境变量由部署者注入；Node 20+ 也可手动使用 `--env-file .env`。这里的 `start` 配置加载属于项目额外封装，`preview` 才是 Nuxt 的本地预览命令。参见 [Nuxt 部署](https://nuxt.com/docs/4.x/getting-started/deployment)和 [Nuxt preview](https://nuxt.com/docs/4.x/api/commands/preview)。

直接执行 `node server/index.mjs`（包括现有 Docker 镜像入口）仍由部署环境注入变量，不读取 `.env`。这种方式下请明确设置工作目录或绝对 `PLATFORM_DATA_DIR`。本批次不改变 Compose 部署流程。

## 诊断边界

Doctor 不输出密钥、数据库密码或 Redis 密码。PostgreSQL 执行只读 `SELECT 1`，Redis 执行 `PING`，连接有超时。PGlite 检查实际 `pglite` 路径的类型、可写性和已有数据库的必要文件/目录；这不等于完整数据校验，不打开数据库、不补建内部目录，也不执行迁移。应用未运行且端口可用是提示；端口占用但就绪失败、配置无效、数据库目录不完整属于错误。

PGlite 只支持一个进程访问同一数据目录。开发、生产和迁移入口共用数据库目录锁；即使使用不同端口，也会拒绝第二个进程。正常关闭数据库后释放锁；异常退出后，仅确认同一主机和 PID 命名空间的原进程已结束时才回收旧锁。跨容器、跨主机或无法识别归属的锁不会自动清理：确认所有访问该数据目录的进程已停止后，才可手动删除错误信息中的 `.openapi-lock` 目录。旧版本和直接使用 PGlite 的外部程序不遵循此锁，首次升级前仍须停止全部旧进程。
