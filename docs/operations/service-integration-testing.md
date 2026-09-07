# Platform 与 Service 集成测试

本文用于验证 `openapi-platform` 管理、配置并代理 `openapi-service` 的完整链路。

## 1. 验证范围

- Platform 创建带 Service Token 的 Upstream，并在管理员确认 Endpoint 后自动创建 Product、Version 和 Route。
- Route 与治理变更先保存到控制面，确认后统一应用到 Routing Revision，并可通过运行快照回滚；相同配置不会重复生成快照。
- Platform 执行 API Key、Scope、限流、积分和调用日志。
- Service 只接收 Platform 注入的 Service Token。
- Platform 发现 Service OpenAPI 和配置 Schema。
- Platform 接受 `openapi-service/v1`，并明确拒绝未支持的 `serviceProtocol`；软件版本号不同不应导致失败。
- Secret 不回显，配置可以同步到多个 Target。
- Service Endpoint 不会因为发现而自动公开。

## 2. 准备数据库

本地测试不配置 PostgreSQL 时自动使用 PGlite：

```powershell
$env:DATABASE_URL = $null
```

PostgreSQL 测试应使用独立空数据库。不要使用生产数据库执行集成测试。

## 3. 启动应用

生成至少 32 字符的独立 Service Token。

Service：

```powershell
cd D:\Project\vscode\openapi-service
$env:API_SERVICE_TOKEN = 'replace-with-independent-random-token'
$env:SERVICE_DATA_DIR = '.data/service-integration'
pnpm dev
```

Platform：

```powershell
cd D:\Project\vscode\openapi-platform
$env:NUXT_AUTH_SECRET = 'replace-with-random-auth-secret'
$env:NUXT_API_KEY_SECRET = 'replace-with-random-api-key-secret'
pnpm dev
```

检查探针：

```powershell
curl.exe -i http://127.0.0.1:8080/healthz
curl.exe -i http://127.0.0.1:3000/api/ready
```

## 4. 创建 Service 连接

登录 `/admin/apis`，完成：

1. 创建 Upstream：
   - Service Token 与 Service 的 `API_SERVICE_TOKEN` 相同。
   - 本机 Target 使用 `http://127.0.0.1:8080`。
   - Compose Target 使用 `http://openapi-service:8080`。
2. 打开 Upstream 的“管理”页面。
3. 点击“发现 Service”。
4. 确认页面显示 Service 身份、Endpoint 和业务配置表单。
5. 返回接口目录，逐个保存发布变更；确认后点击“应用全部变更”。Platform 会自动创建 Product、Version、Route，并一次性生成活动 Revision。

当前官方 Service 可以使用以下 Endpoint 验证：

| 公开 Path | Upstream Path | 建议 API Key | 建议日志 | 示例积分 |
| --- | --- | --- | --- | --- |
| `/v1/yiyan` | `/v1/yiyan` | 是 | 是 | 2 |
| `/v1/player` | `/v1/player` | 否 | 是 | 0 |
| `/v1/player/art` | `/v1/player/art` | 否 | 是 | 0 |
| `/v1/player/assets/{asset}` | `/v1/player/assets/{path.asset}` | 否 | 否 | 0 |
| `/v1/ip` | `/v1/ip` | 是 | 是 | 3 |

Service 发现只导入契约和配置 Schema，不会直接公开接口；管理员保存发布变更并统一应用后，Route 与 Revision 由 Platform 自动完成。表中的治理建议可在接口目录快速切换，也可进入高级设置精细调整。

## 5. 验证治理

创建普通用户和 API Key，并为用户增加测试积分。

缺少 Key 的受保护 Route 应返回 `401 MISSING_API_KEY`，且不扣积分：

```powershell
curl.exe -i http://127.0.0.1:3000/v1/yiyan
```

携带有效 Key 的成功调用应写入 Route 调用明细并扣除配置积分：

```powershell
$env:OPENAPI_TEST_KEY = 'replace-with-user-api-key'
curl.exe -i -H "X-API-Key: $env:OPENAPI_TEST_KEY" http://127.0.0.1:3000/v1/yiyan
```

预检请求应在治理与 Upstream 调用前返回：

```powershell
curl.exe -i -X OPTIONS `
  -H "Origin: https://client.example.test" `
  -H "Access-Control-Request-Method: GET" `
  -H "Access-Control-Request-Headers: x-api-key" `
  http://127.0.0.1:3000/v1/yiyan
```

预期状态为 `204`，不扣积分、不写业务调用明细。

## 6. 验证业务配置

IP 模块提供以下配置示例：

- `ip.enabled`
- `ip.databaseKey`

完成 CZDB 数据目录挂载后，在 Service 管理页面填写数据库密钥并保存：

1. Target 状态应变为 `synced`。
2. 配置 Revision 应增加。
3. 刷新页面后 Secret 只显示“已配置”。
4. 修改 `ip.enabled` 无需重启 Service。

如果一个 Upstream 包含多个相同契约 Target，配置必须发送到全部启用 Target。停止其中一个 Target 后重新同步，Platform 必须显示部分失败或错误。

Service 发现和配置同步包含网络调用。如果后续运行快照发布失败，请求会返回错误，但已记录的 Target 状态不会伪装成“部分发布成功”；修复冲突后可以直接重试相同的发现或同步操作，相同配置 Revision 的下发是幂等的。

停止全部 Service Target 后刷新接口目录或 Upstream 列表，运行状态应显示“离线”；只停止部分 Target 时应显示“部分可用”。重新启动 Target 后再次刷新，状态应恢复为“在线”。发现状态只表示契约已经保存，不能代替运行状态。

## 7. 验证发布与回滚

1. 在接口目录修改 API Key、统计或积分，确认变更先显示为待统一应用，不会立即生成运行快照。
2. 连续保存多个接口后点击“应用全部变更”，确认 Platform 只生成一个包含全部变更的新运行快照且流量立即使用新配置。
3. 不修改任何配置再次应用，确认 Platform 复用当前运行快照，不增加快照数量。
4. 使用高级设置制造路径冲突，确认应用请求失败，Route 变更与新运行快照均回滚，活动流量继续使用旧运行快照。
5. 解决冲突后重新保存并应用变更，确认 Route 与新运行快照同时生效。
6. 在接口目录停用接口并应用全部变更，确认生成新运行快照，公开路径返回 `404 API_NOT_FOUND`。
6. 在运行快照中回滚到停用前的版本，Route 立即恢复。

以上过程都不要求重新构建或重启 Platform。

## 8. 自动化门禁

人工验证前至少运行：

```bash
# openapi-platform
pnpm lint
pnpm typecheck
pnpm check:dead-code
pnpm test:unit
pnpm test:api-service

# openapi-service
pnpm check:unused
pnpm typecheck
pnpm test
pnpm build
```

测试数量会随功能变化，不应在文档中固定具体文件或用例数量。

GitHub Actions 的日常质量工作流只检出 `openapi-service` 的 `main`，以保持 PR 反馈速度。两个仓库各自的 `compatibility` 工作流按周或手动解析对方最新正式 Release，并运行同一套真实链路测试；发布前可手动触发该工作流。两者不要求使用相同版本号，也不建立发布绑定关系。业务 `/v1`、`/v2` 路径由 OpenAPI 发现，和控制协议版本分别验证。
