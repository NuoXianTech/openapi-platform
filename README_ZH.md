<div align="center">

<img src="docs/assets/brand/logo-primary.png" width="136" alt="OpenAPI 标志" />

# OpenAPI Platform

<a href="https://github.com/NuoXianTech/openapi-platform"><img src="https://img.shields.io/github/stars/NuoXianTech/openapi-platform?style=flat-square&logo=github" alt="GitHub stars"></a>
<a href="https://github.com/NuoXianTech/openapi-platform/tags"><img src="https://img.shields.io/github/v/tag/NuoXianTech/openapi-platform?style=flat-square&label=version" alt="Version"></a>
<a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-F4D03F?style=flat-square" alt="License"></a>
<a href="https://nuxt.com"><img src="https://img.shields.io/badge/Nuxt-4.x-00DC82?style=flat-square&logo=nuxt&logoColor=white" alt="Nuxt 4"></a>
<a href="https://ui.nuxt.com"><img src="https://img.shields.io/badge/Nuxt_UI-4.x-00DC82?style=flat-square&logo=nuxt&logoColor=white" alt="Nuxt UI 4"></a>
<a href="https://www.postgresql.org"><img src="https://img.shields.io/badge/PostgreSQL-16%2B-4169E1?style=flat-square&logo=postgresql&logoColor=white" alt="PostgreSQL 16+"></a>

[English](README.md) · [中文](README_ZH.md) · [项目文档](docs/index.md)

OpenAPI Platform 是一个自托管的 API 发布、访问控制、调用统计、积分计费与运营管理平台。

</div>

> [!CAUTION]
> 项目目前处于开发阶段，不保证历史数据兼容。各种本地存储格式都可能直接调整，欢迎关注后续更新。
>
> 如果你需要稳定维护自己的分支，建议自行 fork 后独立开发。二次开发与 PR 请保留原作者信息和前端页面标识。

## 核心功能

- **API 管理模型**：Product、Version、Route、Upstream、Target 与可回滚 Routing Revision。
- **Service 控制面**：按 Internal Upstream 加密保存 Token，发现 OpenAPI 与通用配置 Schema，多 Target 轮询/权重、配置同步和漂移检测。
- **网关治理**：API Key、作用域、IP 白名单、有效期、吊销、Key 配额、API 每日配额，以及秒/分/时/日限流。
- **积分计费**：按 HTTP 方法定价、可审计余额流水、幂等扣费和失败扣费重试。
- **可观测性**：不可变 Route 调用明细、登录日志、管理员操作日志、存活与就绪探针。
- **账号体系**：用户和管理员统一账号、邮箱验证、密码找回、会话失效、GitHub/QQ OAuth 绑定和 Turnstile 防刷。
- **运营后台**：用户、兑换码、每日奖励、公告、站内通知、友情链接、邮件、OAuth、验证码和站点设置。
- **生产部署**：常规生产使用 PostgreSQL；单进程轻量部署可用 PGlite；Redis 提供共享限流、短缓存与后台任务协调。

## 技术栈

- Nuxt 4、Vue 3、TypeScript、Nitro、VueUse
- Nuxt UI 4、Reka UI、Tailwind CSS 4、TanStack Table、Unovis
- Drizzle ORM、PostgreSQL 或 PGlite
- ioredis 提供 Redis 分布式协调
- Zod、Vitest、ESLint

## 运行时配置

| 变量 | 要求 | 说明 |
| --- | --- | --- |
| `NUXT_AUTH_SECRET` | 必填 | JWT、邮箱验证、一次性 token 和 OAuth state 的签名密钥。 |
| `NUXT_API_KEY_SECRET` | 必填 | 用于生成 API Key，并分域保护 API Key、兑换码、Upstream Token 与 Service 业务 Secret。 |
| `DATABASE_URL` | 可选 | PostgreSQL 连接地址。 |
| `NITRO_HOST`、`NITRO_PORT` | 可选 | Node 服务监听地址和端口。 |

配置 `DATABASE_URL` 时使用 PostgreSQL；未配置或留空时自动使用 PGlite。默认数据位置为项目根目录的 `.data/pglite`，可用 `PLATFORM_DATA_DIR` 指定持久化数据根目录。PGlite 只允许一个 Node 进程访问。Redis 可在 `NUXT_REDIS_URL` 留空时不启用；一旦配置 Redis，协调相关操作会在 Redis 不可用时 fail-closed。完整语义见[运行时配置](docs/operations/runtime-config.md)。

## 快速开始

### 本地开发

准备 Node.js 24 和项目指定版本的 pnpm，安装依赖并配置环境变量后启动：

```bash
git clone https://github.com/NuoXianTech/openapi-platform.git
cd openapi-platform
pnpm install --frozen-lockfile
cp .env.example .env
# 在 .env 中填写自己的 NUXT_AUTH_SECRET 和 NUXT_API_KEY_SECRET
pnpm dev
```

配置和密钥由你管理，启动命令只读取和校验，不生成或改写。后续使用：

```bash
pnpm dev          # 日常开发
pnpm build        # 只构建，不连接数据库或要求运行密钥
pnpm start        # 读取 .env，自动迁移并运行已有构建
pnpm run doctor   # 检查配置、依赖、数据目录、端口和就绪状态
```

Node.js、pnpm、依赖安装与环境变量均由你准备。`dev`、`build`、`preview` 使用 Nuxt 原生命令；本地预览运行 `pnpm preview`。项目的 `start` 额外提供只读配置加载和启动检查，随后运行 Nitro 官方入口。详细规则见[本地启动与诊断](docs/operations/local-startup.md)。

### Docker 运行

```bash
git clone https://github.com/NuoXianTech/openapi-platform.git
cd openapi-platform
cp .env.example .env
docker network inspect openapi-network > /dev/null 2>&1 || docker network create openapi-network
docker compose up -d
```

启动前必须配置 `NUXT_AUTH_SECRET` 和 `NUXT_API_KEY_SECRET`。API Key 所有者和管理兑换码的管理员均可按需重复查看完整值，普通列表和历史记录只显示掩码预览；每次查看都会记录不含明文的操作日志。数据库不保存裸明文列，可使用以下命令分别生成独立随机值：

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

运行后可通过 `http://localhost:3000` 访问，Docker Compose 默认只监听本机端口 3000。

## 项目结构

```text
app/                         Nuxt 页面、组件、组合式函数与 UI 资源
server/api/                  站内用户和管理员接口
server/services/             路由、Service 控制面、计费和跨领域规则
server/db/                   Drizzle 客户端、schema 与迁移
server/middleware/           安全响应头与动态 Gateway 入口
server/plugins/              启动初始化、统计和重试任务
shared/                      客户端安全的 schema、契约与配置
docs/                        项目特有标准与生产流程
```

## 项目文档

- [文档入口](docs/index.md)
- [架构文档](docs/architecture/README.md)
- [Platform 架构](docs/architecture/platform.md)
- [Service 架构](docs/architecture/service.md)
- [运行时协议](docs/architecture/runtime-protocols.md)
- [版本与支持范围](docs/architecture/release-scope.md)
- [Platform 与 Service 集成测试](docs/operations/service-integration-testing.md)
- [新增公共接口开发指南](docs/api/public-api-development.md)
- [对外接口规范](docs/api/public-api-conventions.md)
- [前端工程标准](docs/standards.md)
- [API 计费规则](docs/architecture/billing.md)
- [运行时配置](docs/operations/runtime-config.md)
- [VPS 部署指南](docs/operations/vps-deployment.md)

## 贡献

欢迎提交 Issue 和 Pull Request。

## 开源协议

本项目使用 [MIT License](LICENSE)。任何人都可以免费使用、复制、修改、分发、再授权和商业使用本项目，也可以用于闭源产品。
