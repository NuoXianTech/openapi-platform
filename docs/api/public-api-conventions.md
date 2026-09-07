# 对外接口（/v{N}/*）落地规范

Platform v1 的公开 API 全部来自 Service 发现生成的动态 Route。`openapi-platform` 仓库不包含 `/v1/*` 业务 Handler，具体实现位于符合 Service 协议的 API Service。

## 1. 公开路径

- 公开路径通常使用 `/v{N}/<resource>`，不带 `/api` 前缀。
- Path、Method、Host 和上游模板由 Platform Route 保存；接口目录在变更后自动生成并激活 Routing Revision。
- 路径参数使用 OpenAPI 风格 `{id}`；贪婪参数使用 `{path+}`。
- 上游模板引用路径参数时使用 `{path.id}`，例如：

```text
public:   /v1/player/assets/{asset}
upstream: /v1/player/assets/{path.asset}
```

- 新 Route、修改、停用、删除和回滚都不需要构建或重启 Platform。

## 2. 版本

- URL 中的 `v1` 是具体 API Product 的契约版本，不是 Platform 软件版本。
- 破坏输入、输出、错误码或资源语义时创建新 API Version。
- Service 可以先同时提供新旧 Endpoint，再由 Platform 分阶段发布、迁移和下线 Route。
- 业务路径版本与 `serviceProtocol` 独立；新增 `/v2` Endpoint 不要求升级 `openapi-service/v1` 控制协议。

## 3. HTTP 与响应

官方 `openapi-service` 的 JSON 业务响应使用：

```json
{
  "code": "OK",
  "message": "请求成功",
  "data": null,
  "timestamp": 1785542400000
}
```

- `code` 是稳定机器码。
- `message` 是面向人的简短说明。
- `data` 保存业务数据，可以为 `null`。
- `timestamp` 是 Unix 毫秒时间戳。
- HTTP 状态码仍表达真实成功或失败，不因响应壳统一而全部返回 200。
- 官方 Service 的成功 JSON 使用固定 `code=OK` 和默认 `message=请求成功`；错误 JSON 保持同一四字段结构并使用稳定错误码。

HTML、图片、音频、视频、文件和流式响应按真实媒体类型返回，不套 JSON 壳。`/healthz`、`/readyz`、`/openapi.json` 和 `/.well-known/*` 是运行协议文档，也保持原始结构。

Platform Gateway 默认字节保真转发，因此 Service 必须在返回前生成规范响应壳；Gateway 自己产生的鉴权、限流、计费和上游错误也使用同一结构。

## 4. 错误

- 参数错误使用 4xx，稳定 `code` 不包含随机文本。
- 上游超时使用 504，不可用使用 502/503。
- 未知异常不泄露堆栈、Token、Cookie、数据库密钥或第三方响应正文。
- 付费 Route 只有在成功条件满足后结算积分；Service 4xx/5xx 必须释放预留。

## 5. OpenAPI

- Service 使用 Zod/OpenAPI 作为请求、响应和 OpenAPI 3.1 的单一来源。
- Platform 发现并保存 Endpoint 摘要，发现动作本身不会公开 Endpoint。
- 管理员在接口目录明确保存发布变更后，Platform 自动创建或复用 Route；点击“应用全部变更”时才激活 Routing Revision。
- OpenAPI 指纹变化、配置 Schema 变化和公开 Route 变化是三件独立的事。

## 6. 业务配置

- API Key、Scope、限流、积分、统计和公开启停属于 Platform Route。
- 音乐平台开关/Cookie、IP 数据库密钥、Crypto 算法等属于 Service 业务配置。
- Service 通过通用 Schema 声明字段，Platform 自动生成表单并加密保存 Secret。
- Platform 不得增加接口专用业务字段或运行时业务模块注册机制。

## 7. Upstream 安全

- Platform 清除调用方 `Authorization`、Cookie、API Key 和伪造的 `x-openapi-*` 身份头。
- Platform 按 Upstream 注入自己的 `Authorization: Service <token>`。
- Query 中用于 Platform 鉴权的 `apikey` 在转发前删除。
- API Service 默认只在私网暴露；跨不可信网络使用 TLS/mTLS。
- 同一 Upstream 的多个 Target 必须暴露相同 Service 契约。

## 8. 开发与发布

- 新业务逻辑只在 API Service 开发、测试和构建。
- 公开 Route 和治理配置只在 Platform 后台修改；保存后由管理员统一应用当前环境，无需手工编排 Revision。
- 生产服务器不执行 Nuxt Build、TypeScript Build 或 Docker Build。
- 删除 Service Endpoint 前先下线所有活动 Route。

完整流程见[新增公共接口开发指南](public-api-development.md)和[Platform 与 Service 集成测试](../operations/service-integration-testing.md)。
