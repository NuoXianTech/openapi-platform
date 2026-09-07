# 版本与支持范围

本文定义 OpenAPI v1 架构线的产品边界、版本语义、受支持能力和正式发布要求。首个公开版本使用 `0.1.0`，Platform 与 Service 分别维护自己的软件版本和发布产物。

## 1. 版本语义

- **产品架构线**：v1 表示 Platform + Service 的双应用架构，不等同于 Git Tag 或容器标签。
- **软件版本**：`openapi-platform` 与 `openapi-service` 独立遵循语义化版本；首个公开基线均从 `0.1.0` 开始。
- **控制协议**：`openapi-service/v1` 表示 Platform 与 Service 的 HTTP 控制协议版本，不等同于任一应用的软件版本，也不等同于业务 Endpoint 的 `/v1`。
- **开发版本**：`main` 分支构建的 `latest` 用于持续集成和开发验证；正式版本使用不可变 Git Tag、Release 与镜像 digest。

## 2. 产品边界

OpenAPI 由两个独立应用组成：

- `openapi-platform`：管理控制台、管理 API、动态 Gateway、访问治理、积分、统计和运营。
- `openapi-service`：官方业务 Endpoint、业务数据、OpenAPI、业务配置和来源访问。

Platform 不运行具体业务 Handler。Service 不管理 Platform 用户、公开 API Key、积分、公开路径或 Routing Revision。两者只通过文档化 HTTP 协议协作，不共享数据库，也不要求同步发布。

所有 Upstream 必须提供 Service Token，并实现受支持的 Service 发现、OpenAPI 和业务配置协议。外部 API 的输入输出适配由 Service 承担。

## 3. 受支持的管理能力

正式支持范围包括：

- Service 契约自动生成的接口分组、版本和 Route；后台维护展示资料和治理设置，分组标识与版本号只读。
- Upstream 与 Target 的管理生命周期。
- Service Endpoint 接口目录，以及显式确认后的自动 Route 创建和 Revision 发布。
- 不可变 Routing Revision、发布校验、环境激活与历史版本回滚。
- Service Upstream，以及同一 Upstream 内的轮询和加权 Target。
- Service 身份、OpenAPI、配置 Schema 与脱敏配置状态发现。
- 通用业务配置表单、Secret 加密保存、完整快照同步、乐观锁与 Target 漂移状态。
- API Key、Scope、IP、有效期、配额、限流、积分预留与结算。
- Route/Product 维度的目录、调用明细、每日聚合、积分流水与运营统计。
- Platform 与 Service 的独立健康检查、升级、回滚和故障隔离。

管理配置只有进入活动 Routing Revision 后才影响公开流量。Service 发现只更新接口目录；管理员明确发布或修改接口后，Platform 自动创建或更新 Route 并激活 Revision。

## 4. 官方业务接口支持条件

一个官方业务 Endpoint 只有同时满足以下条件，才属于正式支持范围：

1. 存在于 `openapi-service` 源码和确定性 OpenAPI 文档。
2. 具有请求、响应、错误、来源失败和配置行为的自动化测试。
3. 具有公开接口文档，并声明所需业务配置和本地数据。
4. 可以由 Platform 发现，并从接口目录一键生成 Route 与 Routing Revision。
5. 已验证鉴权、限流、积分、调用日志、超时、取消和回滚语义。

官方 Endpoint 清单以 Service 的确定性 OpenAPI 和 `openapi-service/docs/apis/` 为唯一来源，Platform 不复制维护模块清单。源码归档、实验实现或未进入 OpenAPI 的模块不属于产品契约。

## 5. 兼容性规则

- 同一 Upstream 的全部 Target 必须返回相同 Service ID、Service 名称、OpenAPI 指纹、配置 Schema 指纹和控制协议版本。
- 控制协议可以增加可选字段；破坏性协议变化必须发布新的协议版本。
- Platform 与 Service 的软件版本号不参与兼容判断；发现阶段只接受 Platform 明确支持的 `serviceProtocol`，目标组合还必须通过集成测试。
- 业务 Endpoint 可以同时提供 `/v1` 与 `/v2`。Platform 按 OpenAPI 中的实际路径创建对应 Product Version，不要求控制协议或两个应用同步升级。
- OpenAPI 指纹变化必须由管理员审查，不能静默改变现有公开 Route。
- Routing Revision 一经创建不可修改；日常运行时变更由接口目录自动应用，完整配置不变时复用当前 Revision，实际变化时才发布新 Revision。回滚通过重新激活历史 Revision 完成。
- Platform 与 Service 可以独立升级，但目标版本必须满足双方声明的控制协议兼容范围。
- `0.x` 软件版本允许破坏性变化；每次正式发布必须在 Release Notes 中说明数据库、配置、Route 和协议影响。

## 6. 正式发布门禁

每个正式版本至少必须满足：

- Platform 不包含具体公共接口实现、本地业务回退或运行时任意代码加载能力。
- 所有管理对象具备与产品范围一致的创建、编辑、停用、删除保护、权限、审计和测试。
- Service Endpoint 可以被发现和审查；只有管理员明确操作后才自动生成 Route 与 Revision，不允许无确认公开。
- API 目录、日志、统计和积分以 Product/Route 为事实来源，不依赖兼容注册模型。
- Platform 通过 lint、类型检查、死代码检查、单元测试、集成测试、数据库迁移和生产构建。
- Service 通过死代码检查、类型检查、测试、TypeScript 构建和运行时资源检查。
- Linux OCI 镜像通过目标架构、非 root、文件权限、健康检查和资源预算验证。
- Platform、Service、数据库、Redis 和 Upstream 的关键故障语义经过验证。
- Platform、Service、Routing Revision 和数据库均有明确且经过演练的独立回滚路径。
- `package.json`、Git Tag、Release、镜像标签、镜像 digest 与文档中的版本信息一致。

正式发布产物必须在开发机或 CI 构建；生产服务器只运行预构建产物。

## 7. 非目标

以下能力不属于 v1 核心产品承诺：

- 由 Platform 上传、编译或执行任意业务代码。
- 由 Platform 自动部署、停止或升级 Service 进程。
- 发现 Service Endpoint 后未经管理员确认直接公开。
- Platform 与 Service 共享数据库或业务缓存。
- 使用脚本化请求转换替代显式 Route 与 Service 契约。
- 要求 Platform 与 Service 同步停机、构建或发布。

这些边界保证 Platform 保持通用管理职责，Service 保持轻量业务职责，并允许第三方开发者扩展自己的 Service 后接入其部署的 Platform。
