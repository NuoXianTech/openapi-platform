# OpenAPI Platform 文档

OpenAPI Platform 是自托管 API 管理平台，负责动态路由、访问治理、积分、统计与运营。具体官方业务接口由独立的 `openapi-service` 实现。

框架通用能力以 Nuxt 4、Nuxt UI 4、Hono 和相关依赖的官方文档为准；本目录只记录项目自身的架构、协议和操作流程。

## 架构

1. [架构文档入口](./architecture/README.md)
2. [系统概览](./architecture/system-overview.md)
3. [Platform 架构](./architecture/platform.md)
4. [Service 架构](./architecture/service.md)
5. [领域模型](./architecture/domain-model.md)
6. [Platform 与 Service 运行时协议](./architecture/runtime-protocols.md)
7. [部署模型](./architecture/deployment.md)
8. [版本与支持范围](./architecture/release-scope.md)
9. [API 计费规则](./architecture/billing.md)

## API 开发与管理

- [新增公共接口开发指南](./api/public-api-development.md)
- [公共接口业务配置](./api/public-api-capabilities.md)
- [对外接口规范](./api/public-api-conventions.md)
- [RESTful 设计指南](./api/design-style.md)
- [调用统计规范](./api/call-statistics.md)

官方接口的请求、响应和业务错误契约由 `openapi-service/docs/apis/` 维护。Platform 文档只描述如何发现、治理和发布这些 Endpoint。

## 前端与后台

- [前端与后台工程标准](./standards.md)

## 运行与发布

- [运行时配置](./operations/runtime-config.md)
- [数据库迁移与版本升级](./operations/database-migrations.md)
- [Platform 与 Service 集成测试](./operations/service-integration-testing.md)
- [生产就绪清单](./operations/production-readiness.md)
- [发布流程](./operations/release-process.md)
- [生产运行手册](./operations/production-runbook.md)
- [VPS 部署指南](./operations/vps-deployment.md)

## 新增官方 API 的标准流程

1. 在 `openapi-service` 实现业务模块、Zod Schema 和测试。
2. 由 Service 生成 OpenAPI。
3. 需要热更新参数时，在 Service 声明通用业务配置 Schema。
4. 发布 Service 镜像。
5. 在 Platform 创建 Upstream；填写 Service Token 后执行 Service 发现。
6. 在接口目录审查 Endpoint 并保存发布变更；确认后点击“应用全部变更”，Platform 自动创建或复用 Product、Version 和 Route，并一次性激活新的 Routing Revision。
7. 在接口目录或高级设置中配置 API Key、Scope、限流、积分和调用日志；接口目录的变更保存后统一应用当前环境，高级设置按原有保存流程应用。
8. 验证公开路径、失败语义、积分、日志和回滚。

所有接口都通过 Service 的 OpenAPI 契约发现；新建 Upstream 必须提供 Service Token，外部 API 的返回结构由 Service 适配。

## 核心规则

- Platform 不包含具体公共接口实现。
- 所有公开业务流量来自活动 Routing Revision。
- Service 发现只更新契约目录；必须由管理员明确保存发布变更并统一应用，后续 Route 与 Revision 步骤由 Platform 自动完成。
- API Key、限流、积分和调用日志只由 Platform 执行。
- Service 不连接 Platform 数据库。
- 业务模块在 Service 源码中显式组合，不支持运行时加载任意代码。
- Platform 与 Service 是独立进程、镜像和版本线。
- 构建在开发机或 CI 完成，生产服务器只运行预构建产物。

## 质量门禁

Platform：

```bash
pnpm lint
pnpm typecheck
pnpm check:dead-code
pnpm test:unit
pnpm build
pnpm test:integration:built
```

Service：

```bash
pnpm check:unused
pnpm typecheck
pnpm test
pnpm build
pnpm measure:runtime
```

涉及数据库、鉴权、计费或部署时，还必须执行对应集成测试、备份、故障和回滚检查。

## 文档维护

- 一份文档只描述一个稳定边界或可执行流程。
- 不在公开文档中保留历史方案、个人决策记录或已经退出产品范围的实现计划。
- 配置以代码、Schema 和 `.env.example` 为事实来源。
- 示例不得包含真实密钥、用户数据或生产地址。
- 行为变化必须同步更新协议、操作指南和测试。
