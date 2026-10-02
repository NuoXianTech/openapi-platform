import type { H3Event } from 'h3'
import { getHeader, getQuery, sendRedirect } from 'h3'
import { buildCallbackUrl, oauthProviderService } from '~~/server/services/oauth-provider-service'
import { oauthAccountService, OauthBindingError } from '~~/server/services/oauth-account-service'
import { systemSettingsService } from '~~/server/services/system-settings-service'
import { userService } from '~~/server/services/user-service'
import { loginLogService } from '~~/server/services/login-log-service'
import { addRequestOperationLog } from '~~/server/utils/request-operation-log'
import { consumeState } from '~~/server/utils/oauth-state'
import { issuePendingOauth } from '~~/server/utils/oauth-pending'
import { createUserSession, getAuthUser } from '~~/server/utils/auth'
import { githubProvider } from '~~/server/utils/oauth-providers/github'
import { qqProvider } from '~~/server/utils/oauth-providers/qq'
import { readQueryString } from '~~/server/utils/request-query'
import type { ProviderConfig, ProviderProfile, TokenResult } from '~~/server/utils/oauth-providers/types'
import type { LoginMethod } from '#shared/types/login-log'
import type { SupportedOauthProvider } from '#shared/types/oauth'
import { isBanActive } from '~~/server/utils/ban'
import { readClientIp } from '~~/server/utils/request-meta'

function methodFromProvider(provider: SupportedOauthProvider): LoginMethod {
  return provider === 'github' ? 'oauth_github' : 'oauth_qq'
}

async function redirectError(event: H3Event, code: string, mode: 'login' | 'bind' = 'login') {
  const target = mode === 'bind'
    ? `/user/settings?oauth_error=${encodeURIComponent(code)}`
    : `/login?oauth_error=${encodeURIComponent(code)}`
  return sendRedirect(event, target, 302)
}

/**
 * OAuth 回调统一处理：交换 code → 拉取 profile → 登录 / 绑定 / 待处理。
 * 入参 provider 已由路由层（如 /callback/openid/[index]）解析过。
 *
 * 登录模式下若该三方身份尚未绑定任何用户，不再自动建号 / 不再按邮箱静默关联，
 * 而是签发一个短时「待处理 OAuth 身份」并跳转 /oauth/complete，由用户手动
 * 「绑定已有账号」或「新注册」。
 */
export async function handleOauthCallback(event: H3Event, provider: SupportedOauthProvider) {
  const settings = await systemSettingsService.getSettings()

  const query = getQuery(event)
  const stateParam = readQueryString(query.state) || null
  const consumed = consumeState(event, provider, stateParam)
  if (!consumed) {
    return redirectError(event, 'state_mismatch')
  }

  const error = readQueryString(query.error)
  if (error) {
    return redirectError(event, error, consumed.mode)
  }

  const code = readQueryString(query.code) || null
  if (!code) {
    return redirectError(event, 'missing_code', consumed.mode)
  }

  const providerRow = await oauthProviderService.getByProvider(provider)
  if (!providerRow || !providerRow.isEnabled || !providerRow.clientId || !providerRow.clientSecret) {
    return redirectError(event, 'provider_unavailable', consumed.mode)
  }

  const providerConfig: ProviderConfig = {
    clientId: providerRow.clientId,
    clientSecret: providerRow.clientSecret,
    callbackUrl: buildCallbackUrl(settings.siteUrl, provider)
  }

  try {
    let token: TokenResult
    let profile: ProviderProfile

    if (provider === 'github') {
      token = await githubProvider.exchangeCode(providerConfig, code)
      profile = await githubProvider.fetchUserInfo(providerConfig, token.accessToken, token)
    } else {
      token = await qqProvider.exchangeCode(providerConfig, code)
      profile = await qqProvider.fetchUserInfo(providerConfig, token.accessToken, token)
    }

    const ip = readClientIp(event)
    const userAgent = getHeader(event, 'user-agent') || null
    const method = methodFromProvider(provider)

    // ============ bind 模式：当前已登录用户主动绑定 ============
    if (consumed.mode === 'bind') {
      const authUser = await getAuthUser(event)
      if (!authUser) {
        return redirectError(event, 'login_required', 'bind')
      }

      const linkedAccount = await oauthAccountService.bindAccount({
        userId: authUser.id,
        provider,
        providerUserId: profile.providerUserId,
        nickname: profile.nickname,
        avatarUrl: profile.avatarUrl,
        email: profile.email,
        lastLoginIp: ip
      })

      await addRequestOperationLog(event, {
        userId: authUser.id,
        actor: authUser.username,
        action: 'user.oauth.bind',
        resourceType: 'oauth-account',
        resourceId: linkedAccount.id,
        detail: { provider }
      })

      const target = consumed.returnTo && consumed.returnTo.startsWith('/')
        ? consumed.returnTo
        : '/user/settings'
      const sep = target.includes('?') ? '&' : '?'
      return sendRedirect(event, `${target}${sep}oauth_bound=${provider}`, 302)
    }

    // ============ login 模式 ============

    // 该三方身份已绑定某用户 → 立即登录
    const existingAccount = await oauthAccountService.findByProviderUserId(provider, profile.providerUserId)
    if (existingAccount) {
      const user = await userService.getById(existingAccount.userId)
      if (!user) {
        // 用户已被硬删，oauthAccounts 通过 cascade 应已清理；保险起见仍 redirect
        return redirectError(event, 'user_unavailable')
      }
      if (user.isBanned && isBanActive(user)) {
        await loginLogService.record({ userId: user.id, username: user.username, method, success: false, failureReason: 'banned', ip, userAgent })
        return redirectError(event, 'user_unavailable')
      }
      if (user.isBanned) {
        await userService.clearExpiredBan(user.id)
      }
      // 通过 OAuth 新注册但尚未完成邮箱验证的账号：绑定已建、账号仍未激活 → 拦住并提示去验证
      if (!user.isActive) {
        await loginLogService.record({ userId: user.id, username: user.username, method, success: false, failureReason: 'not_active', ip, userAgent })
        return redirectError(event, 'account_inactive')
      }
      await oauthAccountService.bindAccount({
        userId: user.id,
        provider,
        providerUserId: profile.providerUserId,
        nickname: profile.nickname,
        avatarUrl: profile.avatarUrl,
        email: profile.email,
        lastLoginIp: ip
      })
      await createUserSession(event, { id: user.id, role: user.role })
      await userService.updateLastLogin(user.id, ip, userAgent)
      await loginLogService.record({ userId: user.id, username: user.username, method, success: true, ip, userAgent })
      return sendRedirect(event, consumed.returnTo || '/', 302)
    }

    // 未绑定任何用户 → 签发短时待处理身份，跳 /oauth/complete 让用户手动绑定 / 新注册
    issuePendingOauth(event, {
      provider,
      providerUserId: profile.providerUserId,
      email: profile.email,
      nickname: profile.nickname,
      avatarUrl: profile.avatarUrl
    })
    return sendRedirect(event, '/oauth/complete', 302)
  } catch (err: unknown) {
    if (consumed.mode === 'bind' && err instanceof OauthBindingError) {
      return redirectError(event, err.reason, 'bind')
    }
    console.error('[oauth callback] failed', err)
    return redirectError(event, 'callback_failed', consumed.mode)
  }
}
