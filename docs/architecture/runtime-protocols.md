# Platform 与 Service 运行时协议

## 1. 协议范围

Platform 与 API Service 只通过 HTTP 协作。协议包含：

- 公开业务请求代理。
- Service 身份与 OpenAPI 发现。
- 业务配置 Schema、状态与更新。
- Service Token 认证。
- Request ID、Trace Context 和 Route 身份传递。

Service 不读取 Platform 数据库，Platform 不调用 Service 源码模块。

## 2. Service 系统端点

```text
GET /healthz
GET /readyz
GET /openapi.json
GET /.well-known/service.json
GET /.well-known/configuration-schema.json
GET /.well-known/configuration.json
PUT /.well-known/configuration.json
```

`/healthz` 与 `/readyz` 可在受控内部网络免 Token 访问。其余端点要求：

```http
Authorization: Service <token>
```

失败返回 `401`，不得说明 Token 是否存在、长度是否正确或具体的校验细节。

## 3. Service 描述

`GET /.well-known/service.json` 返回稳定 Service 身份和协议入口，至少包含：

```json
{
  "serviceId": "openapi-service",
  "name": "OpenAPI Service",
  "version": "<semver>",
  "commit": "...",
  "serviceProtocol": "openapi-service/v1",
  "openapi": "/openapi.json",
  "openapiSha256": "...",
  "health": "/healthz",
  "readiness": "/readyz",
  "configuration": {
    "schema": "/.well-known/configuration-schema.json",
    "state": "/.well-known/configuration.json",
    "update": "/.well-known/configuration.json",
    "schemaSha256": "..."
  }
}
```

同一 Upstream 的全部 Target 必须返回相同 `serviceId`、Service 名称、`serviceProtocol`、OpenAPI 指纹、配置 Schema 指纹和控制端点。

Target 只有在发现校验通过后才有资格进入新的 Routing Revision。Platform 已保存期望业务配置时，Target 还必须确认相同的配置 Revision 和哈希；未验证、漂移或同步失败的 Target 不接收新增流量。

## 4. OpenAPI 发现

`GET /openapi.json` 返回确定性 OpenAPI 3.1 文档，并提供：

```http
ETag: "<document-sha256>"
X-OpenAPI-SHA256: <document-sha256>
```

Platform 重新计算内容哈希并与 Service 描述和响应头比对。发现成功后保存文档和 Endpoint 摘要，并将业务 Endpoint 展示在接口目录；发现动作本身不会创建公开 Route，但会重新应用管理员此前已经明确发布、因 Target 尚未验证而等待的运行配置。

OpenAPI `info.version` 表示业务 API 契约版本，不使用 Service 镜像或软件发布版本。软件版本继续由 Service Description 的 `version` 字段报告，因此未改变契约的兼容版本可以同时存在于同一 Upstream 中完成滚动更新。

OpenAPI 指纹变化表示 Service 契约变化。新增 Endpoint 显示为“可发布”，缺失 Endpoint 会提示管理员处理；现有公开 Route 不会被静默改写。管理员确认发布、停用或治理变更后，Platform 自动生成新的 Routing Revision。

Platform 按 Operation 的第一个非 `System` Tag 组织 Product。同一逻辑 API 的
多个 Operation 应共享该 Tag。仅作为资产或内部依赖的 Operation 可以声明：

```yaml
x-openapi-platform:
  support: true
```

支撑 Operation 不显示在接口目录，也不能独立配置。Platform 在同组任意公开
Route 启用时自动创建或启用支撑 Route，并强制关闭 API Key、积分和统计；同组
公开 Route 全部停用后自动停用支撑 Route。

## 5. 业务配置协议

### 5.1 Schema

`GET /.well-known/configuration-schema.json` 返回字段分组、类型、默认值、约束、选项和说明。当前协议支持：

- boolean
- text
- textarea
- secret
- number
- single-select
- multi-select

Platform 只理解通用字段类型，不包含模块专用表单逻辑。

### 5.2 状态

`GET /.well-known/configuration.json` 返回：

- `schemaVersion`
- `serviceId`
- `schemaSha256`
- 当前 `revision`
- `configurationSha256`
- 脱敏 `values`
- `updatedAt`

Secret 只能返回：

```json
{ "configured": true }
```

### 5.3 更新

`PUT /.well-known/configuration.json` 接收完整期望快照：

```json
{
  "schemaVersion": 1,
  "revision": 7,
  "values": {
    "module.enabled": true,
    "module.secret": "plaintext-only-in-this-request"
  }
}
```

规则：

- Revision 必须为正安全整数。
- 小于当前 Revision 的请求返回冲突。
- 相同 Revision 与相同指纹返回幂等 ACK。
- 相同 Revision 与不同内容返回冲突。
- 未声明字段和非法值返回验证错误。
- Service 先持久化加密快照，再返回成功 ACK。

Platform 向同一 Upstream 的全部启用 Target 下发相同 Revision 和快照，分别记录结果。部分失败时立即生成只包含已同步 Target 的新 Routing Revision，失败或漂移 Target 不再接收新增流量；期望状态会保留，管理员可以在故障恢复后重新同步。如果某个 Upstream 的全部 Target 失败，Platform 不发布一个没有可用 Target 的定义，而是在后续 Revision 中沿用该 Upstream 最后验证通过的 Target 快照，因此不会阻断其他 Upstream 的独立更新。没有历史有效快照的新 Upstream 必须等待至少一个 Target 验证成功。

## 6. 公开请求转发

Platform 发送给 Service 的请求保留业务 Method、Query、Body 和安全 Header，同时添加：

```http
Authorization: Service <token>
X-Request-Id: <request-id>
X-OpenAPI-Route-Id: <route-uuid>
X-Forwarded-For: <resolved-client-ip>
X-Forwarded-Proto: <http-or-https>
```

Platform 必须删除：

- 调用方 `Authorization`。
- Cookie 和代理认证头。
- `X-API-Key` 等公开 API Key Header。
- Query 中用于 Platform 鉴权的 `apikey`。
- 调用方伪造的 `x-openapi-*` 内部 Header。
- Hop-by-hop Header。

Service 只信任 Platform 重新生成的内部 Header。
Platform 仅在直连代理命中受信 CIDR 且代理客户端信息有效时采用其 `X-Forwarded-Proto`；其他请求使用直连 Socket 协议，调用方不能伪造 Service 用于生成公网链接的协议。

## 7. 响应语义

Service 响应默认保持原状态码、Content-Type 和响应体。业务 JSON 必须使用 `code/message/data/timestamp` 四字段响应壳；Platform 产生的治理错误使用相同结构和稳定平台错误码。外部来源的响应适配在 Service 内完成。

Service 的标准错误响应同时携带：

```http
X-OpenAPI-Error-Code: <stable-error-code>
```

Platform 只使用该受信响应 Header 关联调用日志，不以它替代 HTTP 状态码或 JSON 响应体。调用方不能伪造该值，因为进入 Service 前所有 `x-openapi-*` 请求 Header 都会被清除。

计费结果按状态分类：

- 鉴权、Scope、限流和余额不足：不进入 Upstream，不扣费。
- 网络错误、超时和 Service 失败：释放积分预留。
- 成功结果：结算积分并记录调用。

请求体和响应体限制按实际流式字节累计，不能依赖 `Content-Length`。响应已经
开始流式发送后若超限或连接失败，Gateway 关闭连接而不伪造第二个 JSON 响应，
同时释放积分预留且不得重复计费。

## 8. CORS 与预检

动态 Route 的 `OPTIONS` 预检在 API Key、积分和 Upstream 调用前处理。成功预检返回 `204`，不写业务调用明细，也不消耗积分。

公开 Gateway 统一为成功、错误、重定向、未发布 Route 和不存在 Route 的响应设置 `Access-Control-Allow-Origin: *`，不支持携带 Cookie 的跨域请求，也不设置 `Access-Control-Allow-Credentials`。预检允许 `content-type`、`x-api-key` 和 `x-request-id`，缓存 600 秒；浏览器可以读取 `Location`、`ETag`、`X-Request-Id`、`X-OpenAPI-Error-Code`、限流 Header 和 `Retry-After`。Service 返回的 `Access-Control-*` Header 会被移除，不能覆盖 Gateway 策略。

声明为支撑 Operation 的播放器资产等浏览器子资源由 Platform 自动保持匿名、
零积分且不记录业务统计。

## 9. 超时、取消与重试

- Gateway 为每次 Upstream 请求创建 Deadline。
- 客户端断开时应取消 Upstream 请求。
- `GET` 和 `HEAD` 遇到网络错误或 `502/503/504` 时，可以在同一请求内尝试其余
  非冷却 Target。
- `POST`、`PUT`、`PATCH` 和 `DELETE` 不跨 Target 重放。
- 失败 Target 进入短暂进程内冷却；如果全部 Target 都在冷却，Gateway 允许
  重新探测全部 Target。
- Target 回退共享同一个 Deadline，并保证鉴权、统计和计费只执行一次。
- Service 来源客户端继续使用自己的更短超时和响应大小限制。

## 10. 追踪与日志

Platform 为每次公开请求生成或验证 Request ID，并贯穿调用明细、积分流水和 Service 日志。调用明细记录最终实际请求的 Target ID 与 Base URL；发生安全回退时记录最后处理该请求的 Target。Gateway 错误码以及 Service 返回的 `X-OpenAPI-Error-Code` 会写入调用明细。支持标准 Trace Context 时转发 `traceparent` 与 `tracestate`。

日志不得包含：

- API Key、Service Token、Cookie 和业务 Secret。
- 敏感 Query 的完整值。
- 第三方签名 URL。
- 未限制长度的上游响应正文。

## 11. 协议兼容性

`openapi-service/v1` 是 Platform 与 Service 的控制协议版本，不等同于任一应用的软件版本，也不等同于公开业务路径版本。Service Description 的 `version` 与 `commit` 仅用于展示、排障和审计，Platform 不比较两边的软件版本号，也不据此判断兼容性。

Platform 维护显式支持的控制协议集合。发现先读取稳定的 `serviceProtocol` 字段，再按对应版本校验描述正文；没有共同协议时返回 `SERVICE_PROTOCOL_UNSUPPORTED`，不会带着未知契约继续读取配置或发布 Route。兼容变更可以在同一协议版本中增加可选字段；控制面发生破坏性变化时发布 `openapi-service/v2`，并先为 Platform 增加对应适配和集成测试。

公开业务 Endpoint 的 `/v1`、`/v2` 由 Service OpenAPI 声明，可以同时存在、分别发布并逐步迁移。新增业务 `/v2` 不要求把控制协议升级到 `openapi-service/v2`；只有 `/.well-known/*`、认证、配置同步或发现语义本身不兼容时，才升级控制协议。
