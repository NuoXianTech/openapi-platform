# OpenAPI Platform 架构

## 1. 定位

`openapi-platform` 同时提供管理控制台、管理 API 和动态 API Gateway。它保存 API 管理与运营数据，但不实现具体业务接口。

技术栈：

- Nuxt 4、Vue 3、TypeScript、Nitro。
- Nuxt UI 4 与 Tailwind CSS。
- Drizzle ORM。
- PostgreSQL 或单进程 PGlite。
- Redis 用于共享限流、缓存和多实例协调。

## 2. 内部模块

```text
Nuxt application
├── Console UI
├── Auth and account APIs
├── API management APIs
├── Service control client
├── Routing revision service
├── Dynamic Gateway
├── Access governance
├── Credit settlement
├── Call logging and reporting
└── Operational settings and tasks
```

Console 与 Gateway 共用同一个 Nitro 应用和数据库连接，但在代码中保持明确的领域边界。Gateway 只消费已发布 Revision，不直接读取后台表单草稿来决定流量。

## 3. 管理模型

Platform 使用以下层级描述公开 API：

```text
Platform Runtime
└── Active Routing Revision

API Product
└── API Version
    └── Route

Upstream
└── Target
```

- Platform Runtime 是平台唯一的运行时配置行，持有活动 Routing Revision 和可选默认域名。
- Product、Route、Upstream 全局唯一，整个平台从同一份可发布配置生成一个运行快照。
- Product/Version 组织对外能力和版本生命周期。
- Route 定义公开 Method、Path、Upstream 映射和治理规则。
- Upstream 定义一个逻辑上游，Target 定义一个可请求实例。
- Routing Revision 是可审计、不可变、可回滚的完整运行快照。

## 4. 接口目录与 Routing Revision

`/admin/apis` 是日常接口发布入口。它不是新的持久化领域，也不复制一份发布状态，而是将 Service Endpoint、Route 期望配置和当前活动 Revision 投影为一个接口目录。

Service 的标准流程是：

1. Service 发现更新 OpenAPI 文档和 Endpoint 摘要，但不直接公开接口。
2. 管理员在接口目录明确保存发布变更。
3. Platform 按 Operation 的第一个业务 Tag 自动创建或复用接口分组（Product），并按路径版本创建 Version；默认公开 Path 与 Service Path 相同。后台不提供分组或版本的手工创建入口，分组标识和版本号只读。
4. 发布、停用以及 API Key、统计、积分、限流等治理变更先保存到控制面；管理员点击“应用全部变更”后，Platform 一次性生成并激活运行配置。只有完整配置实际变化时才生成新的 Routing Revision。
5. 标记为 `x-openapi-platform.support=true` 的支撑 Operation 不显示为独立接口，由同组公开 Route 自动带上或停用。
6. 接口设置仅编辑鉴权、积分、统计、限流、超时和大小限制等治理规则；Method、Path 和上游映射由 Service 契约决定。保存进入待统一应用状态。

接口分组页维护名称、说明、可见性与生命周期，版本设置维护发布状态和变更说明。自动复用分组及版本时保留这些设置；已退役的分组或版本必须先显式恢复为可发布状态，才能继续发布接口。

Revision 是 Gateway 的安全运行边界，不是管理员必须手工编排的日常步骤。生成 Revision 时 Platform：

1. 读取全部可发布配置。
2. 校验 Route 冲突、引用完整性和治理约束。
3. 生成规范化 JSON payload。
4. 计算 SHA-256 checksum。
5. 与当前活动 Revision 比较；配置相同则直接复用，不产生重复历史。
6. 配置变化时保存不可变 Routing Revision，并激活到 Platform Runtime。
7. 通知 Gateway 刷新运行时缓存；数据库短暂不可用时最多使用 60 秒的上一个有效快照，超过窗口返回 `503 ROUTING_RUNTIME_UNAVAILABLE`，不伪装成 404。

Route 行保存期望状态，活动 Revision 保存实际流量状态。接口目录的保存与“应用全部变更”分为两个事务：前者只更新控制面，后者校验完整配置并生成/复用快照；冲突校验或引用校验失败时，应用动作回滚，活动流量继续使用旧快照。其他需要立即生效的 Platform 管理对象仍使用单事务自动发布。

Service 发现和配置同步包含对 Target 的网络调用，不能纳入数据库事务。它们采用显式可重试语义：网络结果先按 Target 记录，健康 Target 可先刷新运行快照，失败 Target 标记为 degraded/error；只有全部 Target 都失败时才向调用方返回整体错误。相同配置和相同 Revision 均保持幂等。

后台将该技术概念显示为“运行快照”。运行快照页面只用于审计和回滚；管理员可以重新激活历史 Revision，而不需要恢复旧 Route 行或重启进程。

## 5. 动态 Gateway

Gateway 按以下顺序处理公开请求：

1. 根据 Host、Method 和 Path 匹配活动 Route。
2. 解析调用方身份和客户端 IP。
3. 执行 API Key、Scope、IP、有效期和配额检查。
4. 执行 Route 限流。
5. 为付费调用创建积分预留。
6. 清理调用方认证头和内部保留头。
7. 选择 Upstream Target 并转发请求。
8. 根据响应结果结算或释放积分预留。
9. 写入 Route 调用明细、耗时和积分关联。

未命中活动 Route 时返回稳定的 `API_NOT_FOUND`，不会回退到 Platform 内部业务代码。

## 6. Route 匹配与转发

Route 支持：

- 精确 HTTP Method。
- 精确 Host 和通配 Host。
- 静态 Path。
- `{id}` 单段 Path 参数。
- `{path+}` 尾部通配参数。
- Upstream Path 模板。
- Query 和请求体转发。
- 流式响应转发。
- 请求超时，以及按实际流式字节执行的请求体和响应体上限。

通用 Gateway 默认保留 Upstream 状态码、Content-Type 和响应体。Platform 只为自身产生的鉴权、限流、计费和路由错误使用平台错误契约。

## 7. Upstream

### 7.1 Service 连接

每个 Upstream 都必须连接符合 Service 协议的 API Service，并配置 Service Token：

- Platform 为每个 Upstream 独立加密保存 Service Token。
- 修改 Service Token 先写入待验证版本；发现成功后才提升为活动凭证，期间已发布流量继续使用上一个已验证版本。
- 调用时注入 `Authorization: Service <token>`。
- 删除调用方 `Authorization`、Cookie、API Key 和伪造内部头。
- 可发现 Service 身份、OpenAPI 和业务配置 Schema。
- 管理页面同时检查各启用 Target 的 `readiness` 探针和带 Service Token 的只读控制端点，显示在线、部分可用、离线或未知；曾经完成 Service 发现不等同于当前在线，Token 不匹配也不能显示为在线。
- 多个 Target 必须属于同一逻辑 Service 并暴露相同契约。
- 新增、修改地址或重新启用的 Target 在完成发现前不会进入新的 Routing Revision；存在 Platform 期望配置时，还必须同步到对应 Revision 和哈希。

### 7.2 Target 选择

Target 支持内网地址、容器名、HTTP 与 HTTPS，公网 HTTP 会被拒绝。所有请求均执行 Host、DNS、重定向和凭证安全校验。

一个 Upstream 可以包含多个启用 Target。当前策略包括轮询和加权轮询，权重只
决定请求的首选 Target。网络错误或 `502/503/504` 会让该 Target 短暂冷却；
`GET`、`HEAD` 可以在同一 Deadline 内安全尝试其余 Target，带写语义的请求不会
重放。业务配置仍始终下发到全部启用 Target，与业务流量选择相互独立。

## 8. Service 控制面

管理员在 Upstream 页面执行 Service 发现。Platform 会：

1. 读取 Service 描述。
2. 校验 Service ID、`serviceProtocol` 和契约指纹；当前支持 `openapi-service/v1`，不比较 Service 与 Platform 的软件版本号。
3. 保存确定性 OpenAPI 文档及 Endpoint 摘要。
4. 读取业务配置 Schema 和脱敏状态。
5. 为通用字段生成管理表单。

控制协议只约束发现、配置和认证等 Platform ↔ Service 通信。业务 Endpoint 的 `/v1`、`/v2` 由 OpenAPI 路径决定，可以并存；接口目录按实际路径创建和维护对应 API Version。

业务配置保存后，Platform 使用乐观锁生成更高 Revision，分别向全部启用 Target 下发同一完整快照，并记录 `synced`、`drifted`、`error` 或 `unknown` 状态。部分 Target 失败不会被视为全部成功。

发现成功，或配置同步至少有一个 Target 成功后，Platform 自动重新计算运行配置。相同配置复用当前 Revision；只有验证通过的 Target 集合实际变化时才生成新 Revision。部分同步生成只包含成功 Target 的快照；如果某个 Upstream 的全部 Target 同步失败，则该 Upstream 在后续 Revision 中继续使用最后一个有效 Target 快照，其他 Upstream 仍可独立更新。没有历史有效快照的新 Upstream 会保持待发布状态，直到至少一个 Target 验证成功。期望配置与实际运行状态会保持可见差异，等待管理员修复后重试。发现不会自行创建公开 Route，但可以应用管理员此前已经明确发布、因 Target 尚未验证而等待的 Route。

Secret 使用独立存储域加密。管理 API 只返回是否已配置，浏览器和普通日志永远不会收到明文。

## 9. 访问治理与积分

Route 可以声明：

- 是否要求 API Key。
- 可用 Scope。
- IP 白名单。
- 秒、分、时、日限流。
- 调用日志开关。
- 成功调用积分成本。

付费调用采用“预留—请求—结算”流程。只有成功结果扣除积分；验证失败、网络失败、超时和业务失败会释放预留。重复结算必须保持幂等，余额变化必须有可审计流水。

## 10. 数据与后台任务

Platform 持有：

- 用户、管理员、Session 和 OAuth 数据。
- API Key、Scope 和安全摘要。
- Platform Runtime、Product、Route、Upstream 和 Revision。
- Service Token 与业务配置密文。
- 调用明细、积分预留与积分流水。
- 公告、通知、站点设置和审计日志。

后台任务负责过期 Session、日志清理、积分预留恢复、通知投递和运行时缓存协调。涉及余额或鉴权的关键任务在依赖不可用时必须 fail-closed。

## 11. 安全边界

- Platform 不接受管理员上传或执行任意业务代码。
- 所有 Secret 使用分域密钥加密，日志只记录配置状态。
- API Key 保存查询摘要、受保护密文和掩码预览；普通列表不解密回显，只有 Key 所有者可通过专用接口按需查看完整值，且每次查看都会写入操作日志。
- API Key 可重复查看是产品契约：`keyDigest` 服务鉴权查询，`keyCiphertext` 服务所有者恢复。除非先作出明确产品决策并提供数据迁移，否则不得改成一次性展示模型。
- `NUXT_API_KEY_SECRET` 是数据密钥根；`0.1.0` 不支持 Keyring 或在线主密钥轮换，不能在已有数据库上直接替换。
- 所有 Upstream Target 都必须经过 Host、DNS、重定向和凭证安全校验；公网 HTTP 不允许。
- Upstream 不接收调用方认证凭据。
- 发布、回滚、Token 和 Secret 变更必须写入审计日志。
- PGlite 只支持单 Platform 进程；多实例必须使用 PostgreSQL 和共享 Redis。
