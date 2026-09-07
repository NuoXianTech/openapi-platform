# API 计费规则

本文描述 Service 接口的统一计费链路，适用于单实例与按本文约束部署的多实例环境。Platform 不运行具体公共 API handler。

## 数据模型

- `users.credits` 是用户余额的唯一事实来源。
- `api_routes.credits_cost` 保存 Route 每次成功调用的价格；付费 Route 必须同时启用 API Key 和统计。
- `api_credit_reservations` 是付费调用的持久状态机：`active` 表示 Gateway 正在调用 Upstream，`pending` 表示成功响应必须结算，`dead_letter` 表示重试耗尽且积分继续冻结。可用余额为用户余额减去该用户的所有预留。
- `credit_transactions` 记录每次余额变化，并保留 `balanceAfter` 审计快照；`creditReservationId` 是 API 扣费的持久幂等键。
- 当前没有套餐、订阅、支付网关或月度额度系统。

## 请求链路

1. 动态 Gateway 从活动 Routing Revision 解析 Route、Upstream 和 Target，并读取 Route 的治理字段。
2. Gateway 检查 Route 状态、API Key、Scope、IP 和限流。付费请求在同一事务内通过用户行锁检查可用余额、预占 API Key 积分配额并创建 `active` 预留。
3. Gateway 使用 Service Token 调用 Upstream；具体业务逻辑在 Service 执行。
4. 符合结算条件的上游响应必须先把预留改为 `pending` 才能返回；失败响应则原子恢复 API Key 配额并删除预留。成功结果无法持久化时返回 `503 BILLING_UNAVAILABLE`，避免成功调用逃逸扣费。
5. `server/plugins/api-call-stats.ts` 在响应发出后记录 `api_calls`、更新 `api_call_stats`，关联调用日志并尝试立即结算。
6. `creditService.finalizeReservation` 在同一事务内扣减余额、写入 `credit_transactions`、更新 `api_calls.credits_cost` 并删除预留。事务按 `creditReservationId` 幂等；即使进程在调用日志写入前退出，后台任务也能先完成扣费，再安全补挂调用日志。
7. `server/plugins/credit-reservations-retry.ts` 每 30 秒在 Redis lease 下扫描到期的 `pending` 预留并退避重试；达到上限后进入 `dead_letter`。未配置 Redis 的单实例使用进程内 lease 回退。
8. 后台任务会释放超过 10 分钟的 `active` 预留并恢复 API Key 配额。`pending` 和 `dead_letter` 预留不会被自动释放。

## 可靠性规则

- 不要在 Service 中扣 Platform 积分。Service 只表达成功或失败，扣费由 Platform Gateway 和插件统一处理。
- 不要直接更新 `users.credits`。所有余额变化必须走 `creditService`，或走等价的单事务实现，并同时写入审计流水。
- `credit_transactions.creditReservationId` 在非空时保持唯一，避免同一预留产生重复扣费。
- `api_credit_reservations.status` 仅允许 `active`、`pending` 与 `dead_letter`；只有 `pending` 和人工确认的 `dead_letter` 可进入结算。
- 管理员撤回积分只能消费未预留余额；重置余额低于预留总额时必须拒绝，避免后续结算把余额扣成负数。

## 限流模型

- 未配置 Redis 时，限流器使用进程内存；计数随进程重启而清空，只适用于开发或单实例轻量部署。
- 配置 `NUXT_REDIS_URL` 后，公开 API 与身份防刷使用共享 Redis 原子计数，多实例可获得一致的限流结果。
- 多实例生产必须配置 `NUXT_REDIS_URL`。配置 Redis 后不可用时限流链路 fail-closed，避免实例退回各自内存后绕过限制。
- Route 的秒、分、时、日窗口由 `rateLimitPerSecond/Minute/Hour/Day` 控制；API Key 自身配额不等同于用户余额或 `totalCalls`。

## 人工处置

- 管理员在“积分 → 计费预留”查看 `active`、`pending` 和 `dead_letter`。
- `active` 代表上游仍可能执行，只允许释放；不得人工确认扣费。
- `pending` 可确认扣费或释放。
- `dead_letter` 可重试、确认扣费或释放。
- 操作前应核对上游调用、调用日志和积分流水；所有动作保留操作审计，禁止直接删除数据库行。

## 注册赠送积分

当 `siteSettings.defaultRegisterCredits > 0` 时，`userService.activateUser` 会在用户首次激活时自动写入 `signup_bonus`。邮箱验证和 OAuth 自动注册共用同一条激活路径；后续重复激活受 `users.emailVerifiedAt IS NULL` 保护，不会重复赠送积分。
