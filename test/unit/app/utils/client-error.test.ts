import { describe, expect, it } from 'vitest'
import { parseFetchError } from '~/utils/client-error'

describe('parseFetchError', () => {
  it('uses localized application codes before the raw API message or HTTP status', () => {
    expect(parseFetchError({
      data: {
        message: 'upstream is still referenced by an active routing revision',
        data: { code: 'UPSTREAM_STILL_PUBLISHED' }
      },
      statusCode: 409
    }, '删除失败', { UPSTREAM_STILL_PUBLISHED: '请先下线接口并应用变更', 409: '操作冲突' }))
      .toBe('请先下线接口并应用变更')
  })

  it('keeps the normal fallback for unmapped application codes', () => {
    for (const code of ['UNKNOWN', 'toString']) {
      expect(parseFetchError({
        data: { message: 'Business error', data: { code } }
      }, 'Delete failed', { UPSTREAM_STILL_PUBLISHED: 'Unpublish endpoints first' }))
        .toBe('Business error')
    }
  })

  it('falls back for Zod type errors returned by the API', () => {
    expect(parseFetchError({ data: { message: '无效输入：期望 string，实际接收 数字' } }, '保存失败'))
      .toBe('保存失败')
    expect(parseFetchError({ data: { message: '字段值不合法：无效输入：期望 string，实际接受 数字' } }, '保存失败'))
      .toBe('保存失败')
    expect(parseFetchError({ data: { message: 'Invalid input: expected string, received number' } }, 'Save failed'))
      .toBe('Save failed')
  })

  it('uses status-specific feedback when available for a technical error', () => {
    expect(parseFetchError(
      { data: { message: '无效输入：期望 string，实际接受 数字' }, statusCode: 401 },
      '登录失败',
      { 401: '账号或密码错误' }
    )).toBe('账号或密码错误')
  })

  it('keeps business messages unchanged', () => {
    expect(parseFetchError({ data: { message: '当前密码不正确' } }, '操作失败')).toBe('当前密码不正确')
  })
})
