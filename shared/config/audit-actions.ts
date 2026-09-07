/**
 * 审计动作注册表（单一事实来源）
 *
 * 每个写入 `operation_logs.action` 的动作码都必须在此登记，登记项同时声明它的
 * 「持久化等级」。这样做的目的有三个：
 *   1. 新增审计事件时，i18n 标签缺失会被单元测试直接拦住，而不是在后台退化成裸动作码；
 *   2. 「哪些审计不可丢」不再是每个调用点各自拍板的 `required` 布尔，而是集中策略；
 *   3. 清理与查询侧可以按前缀推断语义，无需硬编码字符串字面量。
 *
 * 登录事件（`auth.login.*`）同样登记在内。它与操作日志同表、同写入内核、同持久化策略，
 * 差别只在展示层：登录日志由专门页面按登录方式渲染，不使用操作日志的动作标签。
 * 因此注册表按「展示面」分成两组，而「持久化等级」对两组一视同仁。
 */
import type { LoginMethod } from '#shared/types/login-log'

/**
 * 审计持久化等级。
 *
 * - `gate`：审计写入是敏感效果交付的前置闸门。写入失败必须中止请求，
 *   宁可让调用方拿到 500，也不能在无痕的情况下把密文交出去。
 *   只适用于「审计发生在效果对外可见之前」的动作，典型是 reveal 类明文披露。
 * - `durable`：安全敏感但业务变更已经落库。此时抛错既不能回滚变更，
 *   也只会把一个已成功的操作伪装成失败，因此不中止请求，
 *   而是重试后降级到结构化 stderr，交由日志采集兜底。
 * - `standard`：常规操作审计。失败仅告警，不影响主流程。
 */
export type AuditCriticality = 'gate' | 'durable' | 'standard'

/**
 * 操作日志动作码 → 持久化等级。
 *
 * 这一组由后台「操作日志」页面渲染，因此每一项都必须有对应的 i18n 动作标签。
 * 未登记的动作码按 `standard` 处理（见 resolveAuditCriticality），但会被
 * test/unit/shared/audit-actions.test.ts 判定为「未登记」而失败，
 * 以此保证注册表不会静默落后于代码。
 */
export const OPERATION_LOG_ACTIONS = {
  // ---- 管理员 · 内容 ----
  'admin.announcement.create': 'standard',
  'admin.announcement.update': 'standard',
  'admin.announcement.delete': 'standard',
  'admin.friend-link.create': 'standard',
  'admin.friend-link.update': 'standard',
  'admin.friend-link.delete': 'standard',
  'admin.api-category.create': 'standard',
  'admin.api-category.update': 'standard',
  'admin.api-category.delete': 'standard',
  'admin.notification.send': 'standard',
  'admin.notification.delete': 'standard',

  // ---- 管理员 · 账号与权限（越权与身份变更的追溯依据）----
  'admin.user.create': 'durable',
  'admin.user.update': 'durable',
  'admin.user.delete': 'durable',
  'admin.user.ban': 'durable',
  'admin.user.unban': 'durable',
  'admin.profile.onboarding.update': 'durable',

  // ---- 管理员 · 密钥（代表他人签发/重置凭据）----
  'admin.api-key.create': 'durable',
  'admin.api-key.update': 'standard',
  'admin.api-key.reset': 'durable',
  'admin.api-key.delete': 'durable',

  // ---- 管理员 · 资金 ----
  'admin.credit.grant': 'durable',
  'admin.credit.revoke': 'durable',
  'admin.credit.reset': 'durable',
  'admin.credit-reservation.charge': 'durable',
  'admin.credit-reservation.release': 'durable',
  'admin.credit-reservation.retry': 'standard',
  'admin.redemption-code.generate': 'durable',
  'admin.redemption-code.delete': 'durable',
  'admin.redemption-code.batch-delete': 'durable',
  'admin.redemption-code.enable': 'standard',
  'admin.redemption-code.disable': 'standard',
  'admin.redemption-code.batch-enable': 'standard',
  'admin.redemption-code.batch-disable': 'standard',
  'admin.redemption-code.reveal': 'gate',

  // ---- 管理员 · 全站配置与鉴权策略 ----
  'admin.settings.update': 'durable',
  'admin.settings.smtp.test': 'standard',
  'admin.oauth-provider.update': 'durable',
  'admin.oauth-settings.update': 'durable',

  // ---- 管理员 · 平台治理（网关拓扑与上游凭据）----
  'admin.platform.upstream.create': 'durable',
  'admin.platform.upstream.update': 'durable',
  'admin.platform.upstream.delete': 'durable',
  'admin.platform.service.token.update': 'durable',
  'admin.platform.service.configuration.update': 'durable',
  'admin.platform.service.configuration.sync': 'standard',
  'admin.platform.service.discover': 'standard',
  'admin.platform.target.create': 'durable',
  'admin.platform.target.update': 'durable',
  'admin.platform.target.delete': 'durable',
  'admin.platform.product.update': 'standard',
  'admin.platform.product.delete': 'durable',
  'admin.platform.version.update': 'standard',
  'admin.platform.version.delete': 'durable',
  'admin.platform.endpoint.update': 'standard',
  'admin.platform.endpoint.apply': 'standard',
  'admin.platform.endpoint.publish': 'durable',
  'admin.platform.endpoint.unpublish': 'durable',
  'admin.platform.revision.activate': 'durable',
  'admin.platform.runtime.update': 'durable',

  // ---- 管理员 · 日志清理（审计链自身的完整性）----
  'admin.call-log.cleanup': 'durable',
  'admin.login-log.cleanup': 'durable',
  'admin.operation-log.cleanup': 'durable',

  // ---- 管理员 · 越权拦截 ----
  'admin.access.denied': 'durable',

  // ---- 用户 · 凭据与会话 ----
  'user.password.change': 'durable',
  'user.password.reset': 'durable',
  'user.email.change.request': 'standard',
  'user.email.change.confirm': 'durable',
  'user.email.verify': 'durable',
  'user.register': 'durable',

  // ---- 用户 · 密钥 ----
  'user.api-key.create': 'durable',
  'user.api-key.update': 'standard',
  'user.api-key.reset': 'durable',
  'user.api-key.delete': 'durable',
  'user.api-key.reveal': 'gate',

  // ---- 用户 · 第三方身份 ----
  'user.oauth.bind': 'durable',
  'user.oauth.unbind': 'durable',
  'user.oauth.register': 'durable',

  // ---- 用户 · 其他 ----
  'user.profile.update': 'standard',
  'user.preferences.update': 'standard',
  'user.checkin': 'standard',
  'user.redemption-code.redeem': 'durable'
} as const satisfies Record<string, AuditCriticality>

/** 登录事件命名空间。与操作日志同表、同写入内核，但由专门的登录日志页面渲染。 */
export const LOGIN_ACTION_PREFIX = 'auth.login.'

/** 登录事件动作码 = 前缀 + 登录方式，由 LoginMethod 单一来源派生。 */
export type LoginLogAction = `${typeof LOGIN_ACTION_PREFIX}${LoginMethod}`

/**
 * 登录事件动作码 → 持久化等级。
 *
 * 全部 `durable`：登录成功是会话创建的唯一凭据，登录失败是识别撞库与账号接管的
 * 唯一线索，两者都不能静默丢弃。这一组不需要操作日志动作标签——登录日志页面
 * 按 `detail.method` 渲染登录方式，与 actionLabels 无关。
 */
export const LOGIN_LOG_ACTIONS = {
  'auth.login.password': 'durable',
  'auth.login.oauth_github': 'durable',
  'auth.login.oauth_qq': 'durable'
  // 键必须恰好覆盖全部 LoginMethod：新增一种登录方式时，这里会直接编译失败，
  // 而不是等到 loginLogService 拼出一个未登记的动作码时才被发现。
} as const satisfies Record<LoginLogAction, AuditCriticality>

/**
 * 全部审计动作码。写入内核只认这个类型，因此登录事件与操作事件共享同一套
 * 截断、重试与降级保证，不会再出现某一侧策略落后的情况。
 */
export const AUDIT_ACTIONS = {
  ...OPERATION_LOG_ACTIONS,
  ...LOGIN_LOG_ACTIONS
} as const satisfies Record<string, AuditCriticality>

export type OperationLogAction = keyof typeof OPERATION_LOG_ACTIONS
export type AuditAction = keyof typeof AUDIT_ACTIONS

/**
 * 解析动作码的持久化等级。
 *
 * 未登记动作按 `standard` 兜底：审计链的可用性不应因为漏登记而中断，
 * 漏登记本身由单元测试暴露。
 */
export function resolveAuditCriticality(action: string): AuditCriticality {
  return (AUDIT_ACTIONS as Record<string, AuditCriticality>)[action] ?? 'standard'
}

/** 后台操作日志动作标签的 i18n key（与 actionLabels 的下划线命名对齐）。 */
export function auditActionMessageKey(action: string): string {
  return `admin.logs.operations.actionLabels.${action.replaceAll(/[.-]/g, '_')}`
}
