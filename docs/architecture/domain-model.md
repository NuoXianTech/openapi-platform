# 领域模型

## 1. 边界

Platform 数据库只保存管理、治理、计费和运营数据。Service 保存或挂载自己的业务数据，不共享 Platform 表。

```text
Platform database                 Service storage
------------------------------    ------------------------------
users / sessions / api_keys       local business datasets
platform_runtime / products       encrypted configuration snapshot
routes / upstreams / revisions    module caches and fixtures
call logs / credit ledger         mounted read-only data files
service tokens / desired config
```

## 2. Platform Runtime

Platform Runtime 是平台唯一的运行时配置行，保存当前对外生效的运行状态。它不是新的运行进程，也不等同于租户计费账号。

核心属性：

- 固定主键 `1`，数据库约束保证只存在一行。
- 可选默认域名；没有自带 Host 的 Route 落在该域名上，默认域名为空时这些 Route 接受任意 Host。
- 活动 Routing Revision 指针。
- 更新时间。

Product、Upstream、Route 全局唯一：`(host, method, path)` 的唯一性由 HTTP 决定，域名是路由真正的隔离轴，因此平台不再按环境切分同一份配置。多套流量环境通过独立部署或不同域名实现。

## 3. Product、Version 与 Route

### 接口分组（Product）

Product 是面向调用方组织接口和授权范围的单位，在后台显示为“接口分组”。首次发布 Service 接口时，Platform 根据业务 Tag 自动创建或复用分组；没有业务 Tag 时使用 Service 分组。管理员可编辑名称、说明、分类、可见性和生命周期，slug 由系统维护，不能手工新建分组或修改其标识。

### API Version

Version 表示分组的契约版本，由 Service 接口路径中的 `/v1`、`/v2` 等版本号自动生成，不能手工创建或修改版本号。管理员可维护版本状态与变更说明；只有允许发布的版本才能进入新的 Routing Revision。后续发布保留已有分组和版本的治理设置，不会自动恢复已退役的对象。

### Route

Route 是 Gateway 的最小可执行规则，包含：

- HTTP Method。
- 公开 Path Pattern 和可选 Host。
- 所属 Product Version。
- Upstream 与 Upstream Path Template。
- 超时、请求体和响应体限制。
- API Key、Scope、IP、限流、积分和日志策略。
- 草稿、可发布、禁用与软删除状态。

Route 使用稳定 UUID。公开路径或名称变化不会改变其审计身份。

## 4. Upstream 与 Target

### Upstream

Upstream 表示同一逻辑 Service 的请求目标集合，创建时必须提供 Service Token 并建立 Service Connection。每个 Target 声明 `http`/`https` 地址，可以是公网域名、内网 IP、localhost 或容器名。

Upstream 包含名称、slug、负载均衡策略和状态。

### Target

Target 表示一个具体 Base URL，包含启用状态、权重、配置同步状态和最近错误。公网 HTTP 不允许；同一 Upstream 的 Target 必须暴露相同 Service 身份和契约，并通过发现校验后才能参与发布。

## 5. Service 连接与配置

Upstream 具有独立 Service 连接记录，保存：

- 加密 Service Token。
- Service ID、名称、版本和 Commit。
- 协议版本。
- OpenAPI 指纹和配置 Schema 指纹。
- 期望配置 Revision 与 SHA-256。
- 非 Secret 配置值和分域加密的 Secret。
- 最近发现、同步和错误状态。

每个 Target 分别记录实际配置 Revision、指纹与同步状态，用于检测漂移和部分失败。

## 6. OpenAPI 文档

Platform 保存 Service 发现取得的 OpenAPI 文档及其内容哈希、来源、规范版本、Endpoint 摘要和抓取时间。

OpenAPI 文档是配置与审查资料，不直接决定公开流量。只有 Route 进入活动 Routing Revision 后，Endpoint 才能被调用。

## 7. Routing Revision

Routing Revision 是平台的完整不可变运行快照，至少包含：

- 单调序号。
- 规范化 payload。
- SHA-256 checksum。
- 构建、发布、失败和被替代状态。
- 创建者和发布时间。

Platform Runtime 通过外键指向活动 Revision。旧 Revision 保留用于审计和回滚。

## 8. API Key 与 Scope

API Key 属于用户账号，保存：

- 查询摘要。
- 授权范围内可恢复的加密值。
- 名称、有效期、启用和吊销状态。
- Scope、IP 白名单和调用配额。
- 使用次数与最近使用时间。

Scope 应引用稳定 Product 或 Route 身份，而不是源码目录或业务模块名称。

## 9. 调用、统计与积分

### 调用明细

每次进入 Upstream 的公开请求形成不可变调用明细，记录 Route、Product、用户、API Key、状态码、耗时、请求标识、积分成本和错误分类。Secret、API Key 明文和敏感 Query 不得写入日志。

### 聚合统计

聚合数据以 Route 和自然日为主要维度，用于趋势、排行和健康状态。聚合结果可重建，调用明细和积分流水是审计事实。

### 积分

积分领域包含：

- 用户余额。
- 积分预留。
- 成功扣除与失败释放。
- 管理员调整、兑换和奖励流水。

余额更新、预留状态和流水必须在事务中保持一致。所有重试使用稳定幂等键。

## 10. 生命周期与删除

- Route、Product、Version、Upstream 和 Target 的删除必须先检查所有活动 Revision；仍被任一活动环境引用时拒绝删除。
- 管理员应先停用相关 Route 并发布不再引用该对象的新 Revision。历史 Revision 保存不可变快照，可继续用于审计，但不能绕过当前活动引用保护。
- Secret 清除必须是显式操作。
- 调用明细和积分流水按保留策略归档，不与配置对象级联物理删除。
- Service Endpoint 删除前，必须先发布不再引用它的 Routing Revision。

## 11. 数据所有权

| 数据 | 所有者 |
| --- | --- |
| 用户、API Key、积分、Route、Revision | Platform |
| Service Token 与期望业务配置 | Platform |
| Service 本地配置快照 | Service |
| 业务数据、来源凭据运行态和缓存 | Service |
| 公开调用明细与治理结果 | Platform |
| 业务 OpenAPI 原始契约 | Service |
| 发现后的 OpenAPI 副本与摘要 | Platform |
