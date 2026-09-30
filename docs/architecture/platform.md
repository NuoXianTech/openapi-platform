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

Endpoint 协调集中在 `server/services/platform-endpoint-service.ts`，对外提供
`list`、`publish`、`update` 和 `synchronizeSupportRoutes`。Endpoint 匹配、目录状态、
Product / Version 复用和支撑 Route 联动是该模块的内部规则。目录选择绑定时优先展示
活动快照中的 Route；发布优先复用期望状态为 active 的 Route；支撑 Route 优先匹配
所属 Version。这些场景的选择顺序有意保持不同。

通用事务与运行快照发布仍由 `platform-endpoint-publication-service.ts` 负责。
Endpoint 协调通过只读的 `getServiceControlView` 读取 Service 契约；Service 发现调用
支撑 Route 同步入口，协调模块不反向依赖发现入口。

`/admin/apis` 是日常接口发布入口。它不是新的持久化领域，也不复制一份发布状态，而是将 Service Endpoint、Route 期望配置和当前活动 Revision 投影为一个接口目录。

Service 的标准流程是：

1. Service 发现更新 OpenAPI 文档和 Endpoint 摘要，但不直接公开接口。
2. 管理员在接口目录明确保存发布变更。
3. Platform 按 Operation 的第一个业务 Tag 自动创建或复用接口分组（Product），并按路径版本创建 Version；默认公开 Path 与 Service Path 相同。后台不提供分组或版本的手工创建入口，分组标识和版本号只读。
4. 发布、停用以及 API Key、统计、积分、限流等治理变更先保存到控制面；管理员点击“应用全部变更”后，Platform 一次性生成并激活运行配置。只有完整配置实际变化时才生成新的 Routing Revision。
5. 标记为 `x-openapi-platform.support=true` 的支撑 Operation 不显示为独立接口，由同组公开 Route 自动带上或停用。
6. 接口设置仅编辑鉴权、积分、统计、限流、超时和大小限制等治理规则；Method、Path 和上游映射由 Service 契约决定。保存进入待统一应用状态。

接口分组页维护名称、说明、可见性与生命周期，版本设置维护发布状态和变更说明。自动复用分组及版本时保留这些设置；已退役的分组或版本必须先显式恢复为可发布状态，才能继续发布接口。

管理台 Endpoint 快捷变更与高级设置保存统一进入
`app/composables/admin/use-admin-endpoint-catalog-operations.ts`。高级设置弹窗只管理草稿和校验；
执行前按当前目录重新检查 Route 与操作准入，保存期间纳入目录占用，反馈关联到同一 Endpoint。
保存后的读取失败单独呈现，不将已成功的变更改报失败；离开页面后忽略旧保存响应。

Product / Version 的编辑上下文、保存、删除确认和列表刷新由
`app/composables/admin/use-admin-product-management.ts` 管理。确认期间保留操作占用，失败可在原确认中重试；
成功读取后重新定位 Product 和 Version，读取失败保留编辑上下文。表单草稿与校验留在各自弹窗。

默认域名保存与历史 Routing Revision 激活由
`app/composables/admin/use-admin-runtime-management.ts` 协调准入、确认、反馈和双资源刷新。
刷新不覆盖未提交的域名草稿，保存成功也不清除请求期间继续输入的内容。
这两类管理模块均区分变更结果和刷新错误，卸载后不再使用旧请求结果或确认回调发起后续操作。

Product、Routing Revision 和 Target 的确认动作共用
`app/composables/use-confirmed-operation.ts`，集中处理重复点击、失败重试、完成后不可重放和作用域失效。
Target 操作还绑定当前 Upstream 上下文，切换详情后旧确认回调和保存结果失效。
领域模块继续负责操作准入、文案和成功后的资源刷新。

Revision 是 Gateway 的安全运行边界，不是管理员必须手工编排的日常步骤。生成 Revision 时 Platform：

1. 按发布范围选择 Route：显式应用全部读取期望配置，自动刷新沿用活动 Revision 的已应用配置，单个 Endpoint 直接发布仅替换指定 Route。
2. 校验 Route 冲突、引用完整性和治理约束。
3. 生成规范化 JSON payload。
4. 计算 SHA-256 checksum。
5. 与当前活动 Revision 比较；配置相同则直接复用，不产生重复历史。
6. 配置变化时保存不可变 Routing Revision，并激活到 Platform Runtime。
7. 通知 Gateway 刷新运行时缓存；数据库短暂不可用时最多使用 60 秒的上一个有效快照，超过窗口返回 `503 ROUTING_RUNTIME_UNAVAILABLE`，不伪装成 404。

完整快照规则集中在 `server/services/routing-revision-compiler.ts`：发布范围、支撑 Route、
父级治理、Target 就绪与历史回退、冲突校验共同生成已应用配置和可执行配置。
编译不执行数据库操作；`routing-revision-service.ts` 在原发布锁和事务内读取所有编译资料，
然后完成去重、写入和激活。历史 Revision 激活复用同一冲突校验，缓存仍在提交后失效。

Route 行保存期望状态，活动 Revision 保存实际流量状态。接口目录的保存与“应用全部变更”分为两个事务：前者只更新控制面，后者校验完整配置并生成/复用快照；冲突校验或引用校验失败时，应用动作回滚，活动流量继续使用旧快照。其他需要立即生效的 Platform 管理对象仍使用单事务自动发布。

Revision 的 `appliedRoutes` 保存最近明确应用的 Route 配置，包括因 Target 未就绪、Product / Version / Upstream 暂不可用而不能执行的 Route；`routes` 只保存当前可执行集合。自动刷新叠加当前分组、版本治理和基础设施状态，不读取待应用的 Route 启停或治理草稿。发现依据已应用的公开 Route 和当前契约维护支撑 Route；因此待停用的公开接口在明确应用前仍有完整支撑能力。回滚后继续以所激活 Revision 的已应用配置为基线。旧 Revision 缺少 `appliedRoutes` 时以其 `routes` 为基线，原 payload 和 checksum 不改写。去重同时比较已应用配置和可执行配置，确保未就绪 Route 的显式应用也可审计。

Service 发现和配置同步包含对 Target 的网络调用，不能纳入数据库事务。它们采用显式可重试语义：网络结果先按 Target 记录，健康 Target 可先刷新运行快照，失败 Target 标记为 degraded/error；只有全部 Target 都失败时才向调用方返回整体错误。相同配置和相同 Revision 均保持幂等。

发现与配置同步通过 `platform-service-control-context.ts` 的 `commitServiceControlContext`
统一接纳异步结果：在事务中锁定连接和 Target，检查凭证、期望配置、Target 地址、启用状态及集合是否仍属于请求开始时的上下文。
上下文变化返回冲突，旧成功或失败结果都不能改写新状态；配置保存和版本恢复从提交后的上下文开始下一次网络请求。
状态写入时间单调推进，避免同一时钟刻度内停用再启用或连续同步使旧结果重新有效。

后台将该技术概念显示为“运行快照”。运行快照页面只用于审计和回滚；管理员可以重新激活历史 Revision，而不需要恢复旧 Route 行或重启进程。

接口目录读取复用已加载的 Upstream 与 Target，只批量读取所引用的 OpenAPI 摘要；
不会为每个 Upstream 重建完整配置视图。没有已发现契约的 Upstream 不读取探测 Token。

配置同步返回已保存的规范化值（Secret 仅返回 configured 状态）与已提交的 Target 观测。
`routingStatus` 独立表示运行快照刷新结果：`applied` 已应用，`skipped` 无成功 Target，
`pending` 表示配置与 ACK 已保存但运行快照刷新失败。管理员重新同步已保存配置时沿用当前配置
Revision，再次尝试刷新运行快照。前端先接纳保存结果，再刷新详情，刷新失败不恢复旧编辑版本。

Endpoint 批量操作在确认返回和每个子请求派发前检查页面生命周期；页面卸载后停止尚未派发的
操作，已发出的请求由服务端完成，旧响应不会继续触发页面刷新。

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

`server/services/dynamic-gateway-call-service.ts` 持有每个请求私有的调用生命周期状态，
统一接纳准入结果与观测、准备付费响应、释放预留，并在响应后写调用明细和结算。
Gateway 和字节限制逻辑通过该模块报告观测，不再直接改写计费与统计的事件上下文字段。
`api-call-stats.ts` 仅将 Nitro `afterResponse` 转交给收尾入口；并发或重复触发共享同一次收尾，
不会重复写调用、累计使用量或结算。交付前持久化失败继续阻止付费成功内容发出；
调用记录或结算失败保留已持久化的 pending 预留，由现有恢复任务重试。

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
- Upstream 编辑通过一次 PATCH 保存属性与可选的待验证 Token；两者和运行快照在同一事务提交，任一步失败全部回滚。凭证缓存只在提交后失效，审计分别记录属性变更和凭证更新状态，不记录 Token 明文。表单草稿与校验留在弹窗，提交和编辑上下文由 `use-admin-upstream-editor.ts` 管理。
- 调用时注入 `Authorization: Service <token>`。
- 删除调用方 `Authorization`、Cookie、API Key 和伪造内部头。
- 可发现 Service 身份、OpenAPI 和业务配置 Schema。
- 管理页面同时检查各启用 Target 的 `readiness` 探针和带 Service Token 的只读控制端点，显示在线、部分可用、离线或未知；曾经完成 Service 发现不等同于当前在线，Token 不匹配也不能显示为在线。
- 多个 Target 必须属于同一逻辑 Service 并暴露相同契约。
- 新增、修改地址或重新启用的 Target 在完成发现前不会进入新的 Routing Revision；存在 Platform 期望配置时，还必须同步到对应 Revision 和哈希。

Service Token 的初始化、暂存、验证后提升、活动读取与控制读取统一由
`upstream-service-token-service.ts` 管理。发现直接使用其已加载控制上下文中的确切凭证，
避免其他实例刚暂存 Token 时，本进程尚未过期的控制缓存让发现验证旧凭证。
提升仍在发现指纹校验后的事务内执行，并校验待提升密文没有变化。
凭证写入登记提交后的本地缓存失效，事务回滚不会改变缓存可见值。

### 7.2 Target 选择

Target 支持内网地址、容器名、HTTP 与 HTTPS，公网 HTTP 会被拒绝。所有请求均执行 Host、DNS、重定向和凭证安全校验。

一个 Upstream 可以包含多个启用 Target。当前策略包括轮询和加权轮询，权重只
决定请求的首选 Target。网络错误或 `502/503/504` 会让该 Target 短暂冷却；
`GET`、`HEAD` 可以在同一 Deadline 内安全尝试其余 Target，带写语义的请求不会
重放。业务配置仍始终下发到全部启用 Target，与业务流量选择相互独立。

Target 更新和删除通过 `committed-transaction.ts` 将健康状态清除登记到最外层事务。
独立变更等待自身提交，带发布的变更等待 Target 与 Routing Revision 一并提交；
提交失败不清除本地或 Redis 健康状态。登记提交后动作的内部写入必须使用
`withCommittedTransaction` 所拥有的事务，不能把普通外部事务当作已经提交。

健康观测、驱逐、恢复和失效由 `gateway-target-health.ts` 集中管理。探测和转发在网络请求开始前
登记观测，结束时提交结果；重置前的观测及晚于新结果到达的旧观测不再被接纳。状态按
Upstream、Target 和地址隔离，地址替换不会继承旧地址的失败。
`gateway-target-health-store.ts` 提供内存与 Redis 存储，保留带时间戳的恢复记录和重置标记，
防止延迟回填或旧写入恢复已清除的驱逐状态。共享读取最多占用 100ms，故障仍使用本地状态。
跨实例排序使用观测时间，部署实例应保持时钟同步。Redis 使用 v2 健康状态键，升级后重新累计
短期观测，旧键按原 TTL 自然过期；这不涉及数据库或 Routing Revision 迁移。

### 7.3 管理台 Target 操作

Upstream 详情由 `platform-upstream-detail.ts` 从当前对象的控制上下文构建，管理资料、配置和
Target 状态共用一次读取范围及一次探测集合。详情不会为补齐管理资料而读取或探测全部 Upstream。
前端 `use-admin-service-control.ts` 使用一个私有详情资源刷新，继续区分保存结果与后续读取失败，
切换对象时同步清除控制视图、管理资料和敏感草稿。

服务列表、服务详情与 Target 编辑弹窗通过
`app/composables/admin/use-admin-target-operations.ts` 执行保存、启停和删除。
该模块统一管理准入、确认、执行状态与反馈，页面提供各自的数据刷新逻辑，弹窗保留表单与校验。
确认期间保留操作占用，变更失败时确认弹窗保持打开供重试；保存结果决定编辑弹窗是否关闭。
刷新失败与变更失败分别处理，已成功的变更不会因刷新失败而再次提交。
详情页将 Target 操作状态纳入 Service 控制操作的禁用规则。

## 8. Service 控制面

管理台通过 `app/composables/admin/use-admin-service-control.ts` 协调发现、Token 更新、
配置保存与同步。该模块持有控制视图、刷新和反馈，统一输出操作准入状态，并与 Target 操作互斥。
每次操作绑定发起时的 Service 上下文；切换 Service 或卸载后，旧响应不能覆盖当前反馈、清空新 Token 草稿或解除新操作的占用。
配置草稿仍由 `use-admin-service-configuration-form.ts` 管理：可用性刷新保留编辑，已保存 Revision 变化后重置草稿。
保存与同步共用结果解释，配置 Revision 与 Routing Revision 保持区分；读取失败单独显示，不改写已完成的变更结果。

管理员在 Upstream 页面执行 Service 发现。Platform 会：

1. 读取 Service 描述。
2. 校验 Service ID、`serviceProtocol` 和契约指纹；当前支持 `openapi-service/v1`，不比较 Service 与 Platform 的软件版本号。
3. 保存确定性 OpenAPI 文档及 Endpoint 摘要。
4. 读取业务配置 Schema 和脱敏状态。
5. 为通用字段生成管理表单。

控制协议只约束发现、配置和认证等 Platform ↔ Service 通信。业务 Endpoint 的 `/v1`、`/v2` 由 OpenAPI 路径决定，可以并存；接口目录按实际路径创建和维护对应 API Version。

业务配置保存后，Platform 使用乐观锁生成更高 Revision，分别向全部启用 Target 下发同一完整快照，并记录 `synced`、`drifted`、`error` 或 `unknown` 状态。部分 Target 失败不会被视为全部成功。

发现和配置同步的 Target 观测统一进入 `platform-service-control-context.ts` 的
`acceptServiceTargetResults`。该入口在指纹校验后的同一事务内，按当前期望配置判断状态，
使用统一时间戳写入 Target，并拒绝重复或不属于原启用 Target 集合的观测。
发现可以在这个事务中先更新契约，结果分类使用更新后的契约；网络失败保留上次观测事实，
同时标记 error。配置同步只有全部启用 Target 匹配时才更新连接的整体同步时间。

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

私有读取统一由 `use-private-resource.ts` 管理请求序号、取消、作用域关闭和错误状态，只在客户端挂载后读取，使用本地 ref，不进入 Nuxt SSR payload。`refresh` 返回 `success`、`error`、`superseded` 或 `disposed`，调用方据此决定是否展示读取错误或更新编辑上下文；读取失败不会把已完成的写操作改报失败。作用域关闭后保留的刷新方法不再发起请求，也不接纳旧响应。`use-private-paged-list.ts` 复用该生命周期，只负责查询、响应校验和末页修正，修正后的最终读取结果返回给调用方。详情失败保留已有数据，分页失败清空旧列表。

系统设置编辑由 `use-admin-settings-page.ts` 管理已发送快照、当前草稿和已保存基线。
普通保存与 OAuth 批量保存共用操作准入和结果接纳；成功响应更新基线，仅回写提交后未继续编辑的字段。
初始读取和 OAuth 配置刷新保留已有草稿，只写 Secret 仅清除本次提交且未再次编辑的值。
网络设置只在保存成功、模式和相关草稿都未继续变化时重置依赖字段；失败或页面卸载不会继续应用旧结果。

运行快照、有效代理配置和 Service Token 的进程内缓存统一使用 `local-snapshot.ts`。
加载合并、替换、失效、容量淘汰与清空均按缓存条目身份隔离旧读取；旧调用可以完成，
但不能回填新条目，也不能清除新条目的加载状态。各领域仍负责 TTL、校验和故障回退。
代理配置保存后立即替换本地快照，迟到的旧读取不能覆盖它，显式环境配置仍优先。
Routing Runtime 保留最后验证成功的时间，重试、失效或缓存命中都不能延长 60 秒回退上限。
Token 明文只进入有容量上限的进程内缓存，不进入 Redis；跨实例常规读取仍受 5 秒 TTL 约束。

公开内容缓存由 `shared-cache.ts` 统一处理加载合并和失效。失效会分离本进程的旧加载；
Redis 通过原子读和条件写校验随机版本标记，其他实例已开始的加载也不能回填失效后的缓存。
锁按版本隔离；版本标记可过期，丢失的标记不能授权旧结果写入。旧请求可以完成，但失效后的请求不会加入它。
Redis 不可用时仍按原约定回源或使用有 TTL 的内存缓存；此期间无法保证跨实例即时失效。

Platform 持有：

- 用户、管理员、Session 和 OAuth 数据。
- API Key、Scope 和安全摘要。
- Platform Runtime、Product、Route、Upstream 和 Revision。
- Service Token 与业务配置密文。
- 调用明细、积分预留与积分流水。
- 公告、通知、站点设置和审计日志。

后台任务负责过期 Session、日志清理、积分预留恢复、通知投递和运行时缓存协调。涉及余额或鉴权的关键任务在依赖不可用时必须 fail-closed。

## 11. 安全边界

密码重置、当前密码修改和邮箱确认由 `user-credentials-service.ts` 完整消费凭据。
写入必须匹配验证时的邮箱、密码摘要和 tokenVersion；密码计算在事务外，条件 UPDATE 决定
唯一成功者。改密后的 Session 只能绑定本次提交产生的版本，不得借后续并发改密签发新会话。

匿名密码注册的创建、激活、投递和补偿由注册模块统一归类；邮件或激活失败仍返回中性结果，
内部记录失败原因。持有 OAuth pending 身份的注册保留明确错误。两条入口共用域名与邀请码规则。

通知中心由 `useNotifications` 统一管理列表、未读数和已读操作，复用 `usePrivateResource`。
写入开始和完成时使旧读取失效，写入期间暂停新读取，完成后读取权威状态；作用域关闭后不发后续请求。

Gateway、Service 控制与健康探测统一通过 `fetchUpstreamTarget` 访问受管 Target。
HTTP 名称的全部 DNS 地址必须为允许的私网地址，校验后的地址直接用于固定连接；公共地址使用 HTTPS。

- Platform 不接受管理员上传或执行任意业务代码。
- 所有 Secret 使用分域密钥加密，日志只记录配置状态。
- API Key 保存查询摘要、受保护密文和掩码预览；普通列表不解密回显，只有 Key 所有者可通过专用接口按需查看完整值，且每次查看都会写入操作日志。
- API Key 可重复查看是产品契约：`keyDigest` 服务鉴权查询，`keyCiphertext` 服务所有者恢复。除非先作出明确产品决策并提供数据迁移，否则不得改成一次性展示模型。
- `NUXT_API_KEY_SECRET` 是数据密钥根；`0.1.0` 不支持 Keyring 或在线主密钥轮换，不能在已有数据库上直接替换。
- 所有 Upstream Target 都必须经过 Host、DNS、重定向和凭证安全校验；公网 HTTP 不允许。
- Upstream 不接收调用方认证凭据。
- 发布、回滚、Token 和 Secret 变更必须写入审计日志。
- PGlite 只支持单 Platform 进程；多实例必须使用 PostgreSQL 和共享 Redis。
