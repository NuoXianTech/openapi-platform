# 新增公共接口开发指南

Platform v1 不承载具体公共接口代码。新增接口在 `openapi-service` 或实现相同 Service 协议的服务中开发，通过 OpenAPI 契约发现后，由 Platform 接口目录发布。

外部 API 的请求适配、返回结构和错误码转换都由 Service 完成。Platform 只管理符合统一契约的接口，不提供任意 HTTP API 的直接接入入口。

不要在 `openapi-platform/server/routes/v1` 或 `server/lib/<business>` 增加业务 Handler。

## 1. 开发与接入 Service

需要开发或维护官方公共接口时：

1. 在 `openapi-service` 定义稳定输入、输出和错误码。
2. 使用 Hono + Zod/OpenAPI 实现 Endpoint，并在显式组合根注册。
3. 外部来源必须使用受控 Source Client，限制 Host、重定向、超时、取消和响应大小。
4. JSON 业务响应使用统一 `code/message/data/timestamp` 壳；文件、HTML、流和 well-known 协议文档按各自媒体类型返回。
5. 补单元、Fixture、HTTP 和 OpenAPI 契约测试。
6. 只构建并发布 API Service。
7. 在 Platform 创建 Upstream，填写 Target 和必填的独立 Service Token。多个 Target 必须属于同一逻辑 Service 并提供一致契约。
8. 执行“发现 Service”，查看 OpenAPI Endpoint 和配置 Schema。
9. 在接口目录审查 Endpoint 并保存发布变更。Platform 默认沿用 Service Path 作为公开 Path，自动创建或复用 Product、Version、Route；确认后应用全部变更并激活新的 Routing Revision。

Service OpenAPI 变化不会在未经确认时暴露新 Endpoint，也不会静默改写现有公开 Route。新增 Endpoint 会显示为“可发布”，管理员明确保存并应用后才生效。

接口分组与版本无需预先创建。首次发布时，Platform 根据业务 Tag 和接口路径自动生成；后台可编辑分组资料、可见性、生命周期以及版本状态和变更说明，分组标识和版本号只读。重新发布不会覆盖已保存的资料，也不会自动恢复已退役的分组或版本。

## 2. 业务配置

模块开关、音乐 Cookie、IP 数据库密钥、Crypto 算法等字段在各自的 `src/modules/<module>/configuration.ts` 声明，并由 `src/modules/index.ts` 显式组合。Platform 只根据通用字段类型生成表单：

- boolean
- text / textarea
- secret
- number
- single-select / multi-select

Secret 会在 Platform 数据库和 Service 本地快照中分别加密，管理读取只返回是否已配置。新增配置字段只修改和发布 Service，不修改 Platform。

禁止运行时业务模块注册、目录扫描、Platform 业务专用字段和远程模块路径。

## 3. 接口治理

Service 契约决定请求方法、路径和参数，Platform 根据发现结果生成 Route。接口设置页用于管理：

- API Key 鉴权。
- 限流、积分、统计、超时和响应大小。
- 发布、下线和历史 Revision 回滚。

治理变更保存为待应用状态；点击“应用全部变更”后，Platform 生成或复用 Routing Revision。Target 地址和负载策略在上游服务页管理。只有 Service 业务代码、OpenAPI 或配置 Schema 变化才需要构建 Service。

## 4. 删除接口

1. 先在 Platform 接口目录停用公开接口，再应用全部变更；Platform 会发布不再包含该 Route 的 Revision。
2. 确认活动 Revision 不再引用 Endpoint。
3. 从 Service 删除实现、Schema、资产和测试。
4. 发布 Service 并重新执行发现。

## 5. 参考

- [RESTful API 设计风格](design-style.md)
- [对外接口落地规范](public-api-conventions.md)
- [公共接口业务配置](public-api-capabilities.md)
- [Platform 与 Service 运行时协议](../architecture/runtime-protocols.md)
- [Platform 与 Service 集成测试](../operations/service-integration-testing.md)
