# API 请求调用统计规范

本文定义动态 Route 的调用明细和当前统计口径。后台内部接口不属于公开 API 统计。

## 1. 当前事实来源

| 口径 | 存储 | 说明 |
| --- | --- | --- |
| 调用明细 | `api_calls` | 每次可归属请求的 Route、用户、Key、状态、耗时、积分和脱敏 Query |
| API Key 使用 | `api_keys.total_calls` | Key 通过治理并实际进入 Upstream 调用的次数 |
| Route 日聚合 | `api_call_stats` | 以 `route_id + stat_date` 聚合计数、成功数和失败数 |

调用明细、日聚合、目录排行和运营统计统一使用稳定 Route UUID，不存在第二套整数 API 身份。

## 2. 请求阶段

1. Gateway 从活动 Routing Revision 解析 Route。
2. 缺失或无效 API Key 无法可靠归属用户，不写调用明细。
3. 已识别 Key 后的 Scope、IP、限流、余额等拒绝可以写 `is_counted=false` 明细，便于审计，但不算成功调用。
4. 进入 Upstream 后，响应钩子写入 Route 调用明细。
5. 付费成功调用关联积分预留和 `credit_transactions`；失败调用释放预留并记录实际 4xx/5xx。

统计写入在响应阶段执行。失败不能修改已经返回给调用方的业务响应，但必须写服务端错误日志并保留可重试的计费状态。

## 3. 安全与脱敏

- 调用方 API Key、Service Token、Cookie 和业务 Secret 不进入日志。
- Query 中的 `apikey` 在转发和保存前移除。
- Authorization 和内部身份 Header 不保存明文。
- 错误详情不保存第三方完整响应正文或签名 URL。
- IP 按 Platform 的可信代理策略解析，不能直接相信调用方伪造的转发头。

## 4. 计数规则

- `is_counted=true` 表示该明细进入 Route 聚合口径。
- 默认 2xx/3xx 为成功，4xx/5xx 为失败；Gateway 治理拒绝按稳定错误码记录。
- CORS `OPTIONS` 预检在治理和 Upstream 调用前返回，不计费、不写业务调用明细。
- `is_statistics=false` 的 Route 不写普通调用明细；播放器静态资产应使用该配置，避免制造噪声。
- 缺失/无效 Key、未命中 Route 和 Platform 内部接口不进入公开 Route 统计。

## 5. API Key 次数

`api_keys.total_calls` 表达“该 Key 被接受并进入 Upstream 调用多少次”，不是业务成功次数：

- 缺失、无效、禁用或过期 Key 不累加。
- Scope、IP、限流、余额不足等治理拒绝不累加。
- Upstream 返回业务 4xx/5xx 时已经发生调用，可以累加 Key 使用，但付费预留必须按结算规则释放。

## 6. Route 聚合要求

每条 `is_counted=true` 调用明细与对应 `route_id + stat_date` 聚合在同一数据库事务中写入。后台趋势、目录排行和健康状态读取同一聚合事实；`is_counted=false` 的治理拒绝只保留审计明细，不进入聚合。相关对账测试属于正式发布门禁，详见 [版本与支持范围](../architecture/release-scope.md)。

扣费状态机见 [API 计费规则](../architecture/billing.md)。

## 7. 看板小时统计

`server/services/call-hourly-statistics.ts` 统一拥有小时查询、窗口、分桶、补零与时间标签。
用户看板读取以本次观察时间为终点的滚动 24 小时，按该窗口划分 24 个连续的一小时区间；
管理员看板仍读取截至当前应用本地整点的 24 个完整小时，不包含当前未结束的小时。
两者均使用左闭右开区间，`hour` 表示该区间的排他结束时间，标签显示应用本地时间。
例如用户在 13:30 查看时，首个区间为昨日 13:30–14:30，末个区间为今日 12:30–13:30。

SQL 按相对窗口起点的经过秒数分桶，不依赖数据库会话时区。用户的近 24 小时调用总数、
积分消耗和小时图来自同一次聚合；调用总数仅包含 `is_counted=true`，成功需要 2xx/3xx
且没有错误码，其余已计数调用为失败。积分消耗沿用调用明细的 `credits_cost` 求和。
看板 module 只消费完整统计结果，不再自行构造小时窗口或补齐时间点。
行为测试通过两个看板的读取 interface 与隔离 PGlite adapter 验证首尾区间、用户隔离、
错误分类、空窗口和数据库时区差异。
