import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  AUDIT_ACTIONS,
  auditActionMessageKey,
  LOGIN_ACTION_PREFIX,
  LOGIN_LOG_ACTIONS,
  OPERATION_LOG_ACTIONS,
  resolveAuditCriticality
} from '#shared/config/audit-actions'

const LOCALES = ['zh-CN', 'en-US'] as const

function readActionLabels(locale: string): Record<string, string> {
  const json = JSON.parse(readFileSync(`i18n/locales/${locale}/admin/logs.json`, 'utf8'))
  return json?.admin?.logs?.operations?.actionLabels ?? {}
}

function labelKeyFor(action: string): string {
  return auditActionMessageKey(action).replace('admin.logs.operations.actionLabels.', '')
}

describe('audit action registry', () => {
  it.each(LOCALES)('%s labels exactly the registered operation-log actions', (locale) => {
    const labels = readActionLabels(locale)
    expect(Object.keys(labels).sort()).toEqual(Object.keys(OPERATION_LOG_ACTIONS).map(labelKeyFor).sort())
    const loginLabels = new Set(Object.keys(LOGIN_LOG_ACTIONS).map(labelKeyFor))
    expect(Object.keys(labels).filter(key => loginLabels.has(key))).toEqual([])
  })

  it('registers every action exactly once and reserves the login namespace for login logs', () => {
    // Array equality also catches duplicates across the two display groups.
    expect(Object.keys(AUDIT_ACTIONS).sort()).toEqual(
      [...Object.keys(OPERATION_LOG_ACTIONS), ...Object.keys(LOGIN_LOG_ACTIONS)].sort()
    )
    expect(Object.keys(AUDIT_ACTIONS).filter(action => action.startsWith(LOGIN_ACTION_PREFIX)).sort())
      .toEqual(Object.keys(LOGIN_LOG_ACTIONS).sort())
  })

  it('treats secret disclosure as a gate and credential changes as durable', () => {
    expect(resolveAuditCriticality('user.api-key.reveal')).toBe('gate')
    expect(resolveAuditCriticality('admin.redemption-code.reveal')).toBe('gate')
    expect(resolveAuditCriticality('user.password.change')).toBe('durable')
    expect(resolveAuditCriticality('user.password.reset')).toBe('durable')
    expect(resolveAuditCriticality('admin.operation-log.cleanup')).toBe('durable')
    expect(resolveAuditCriticality('user.profile.update')).toBe('standard')
  })

  it('treats every login event as durable', () => {
    // 登录成功是会话创建的唯一凭据，登录失败是识别撞库的唯一线索。
    for (const action of Object.keys(LOGIN_LOG_ACTIONS)) {
      expect(resolveAuditCriticality(action)).toBe('durable')
    }
  })

  it('falls back to standard for unknown actions so audit availability is never blocked', () => {
    expect(resolveAuditCriticality('totally.unknown.action')).toBe('standard')
  })

  it('derives i18n keys by flattening dots and dashes', () => {
    expect(auditActionMessageKey('admin.api-key.reset'))
      .toBe('admin.logs.operations.actionLabels.admin_api_key_reset')
  })
})
