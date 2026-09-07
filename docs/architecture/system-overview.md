# 系统概览

## 1. 产品定位

OpenAPI Platform 是一个自托管的 API 管理平台。管理员从 Service 接口目录发现并发布公开 Endpoint，统一应用鉴权、限流、积分、调用日志和运营规则。

具体业务接口由独立的 `openapi-service` 或实现相同 Service 协议的服务提供。外部来源的请求和响应适配在 Service 内完成，Platform 只接入符合统一契约的 Service。

## 2. 系统拓扑

```text
Administrator / API consumer
              |
              v
┌──────────────────────────────────────┐
│ openapi-platform                     │
│ Console + Admin API + Nitro Gateway  │
│ Route / Auth / Limit / Credit / Log  │
└──────────────────┬───────────────────┘
                   │ HTTP + Service Token
                   v
┌──────────────────────────────────────┐
│ API Service                          │
│ Business API + OpenAPI + Config      │
│ Source adapters + Unified responses │
└──────────────────────────────────────┘
```

数据库和 Redis 属于 Platform 基础设施。Service 不连接 Platform 数据库，也不读取用户、API Key、积分或 Routing Revision。

## 3. 职责矩阵

| 能力 | Platform | Service |
| --- | --- | --- |
| 管理后台与账号 | 是 | 否 |
| Product、Route、Upstream | 是 | 否 |
| API Key、Scope、IP、限流 | 是 | 否 |
| 积分预留、结算与流水 | 是 | 否 |
| Routing Revision 与回滚 | 是 | 否 |
| 具体业务参数和响应 | 否 | 是 |
| 本地业务数据和第三方来源 | 否 | 是 |
| 业务 OpenAPI | 发现与保存 | 生成与发布 |
| 业务配置 Schema | 渲染、加密、下发 | 声明、校验、应用 |
| Service 进程和镜像生命周期 | 否 | 独立部署系统负责 |

## 4. 三类独立变更

### 4.1 路由与治理变更

公开路径、Method、Upstream、API Key、积分、限流、统计和启停属于 Platform 配置。接口目录先保存变更，管理员统一应用当前环境后才更新运行配置；只有完整配置实际变化时才生成并激活新的 Routing Revision，相同配置复用当前快照。不要求重新构建 Platform 或 Service。

### 4.2 Service 业务配置变更

模块开关、来源凭据、Cookie、数据库授权密钥、算法允许列表等由 Service Schema 声明。Platform 保存后向同一 Upstream 的全部 Target 下发，不要求重新构建。

### 4.3 代码与部署变更

接口实现、OpenAPI、配置 Schema 或依赖变化需要重新构建 Service。监听地址、数据目录、Service Token、网络和进程资源变化通常只需要滚动重启对应应用。

## 5. 核心约束

- Platform 运行时不包含任何具体公共接口 Handler。
- 所有公开业务流量必须命中活动 Routing Revision。
- Service 发现本身不会公开 Endpoint；管理员必须在接口目录明确发布，Platform 随后自动完成 Route 与 Revision。
- Upstream 使用独立 Service Token，调用方凭据不会透传给 Service。
- Service 模块在源码中显式组合，不支持运行时加载任意代码或远程模块。
- Platform 与 Service 是两个独立进程、镜像和版本线。
- 生产服务器只运行预构建产物，不执行依赖安装或构建。

## 6. 官方 Service 当前能力

官方能力不在 Platform 文档中维护第二份易过期清单。当前可发现契约以 Service OpenAPI 为准，接口说明以 `openapi-service/docs/apis/` 为准；不存在于 Service OpenAPI 的源码、归档或实验实现不属于产品契约。
