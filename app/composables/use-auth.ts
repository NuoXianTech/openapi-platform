import { computed } from 'vue'
import type { AuthUser, LoginInput, RegisterInput, UserProfile } from '#shared/types/auth'
import type { SupportedLocale } from '#shared/config/locale-defaults'

// 登录态新鲜期：超过这个时长后，下一次 fetchMe()（中间件导航 / 插件定时器）会重新打 /api/auth/me，
// 用来在长会话里捕获后端封禁、踢人、session 失效等服务端状态变化。
const AUTH_FRESH_FOR_MS = 5 * 60 * 1000

// 这些模块变量只管理客户端读取和身份轮次，不进入 useState 或 SSR payload。
// 服务端只使用下方 event.context 中的请求级状态，不跨请求复用缓存或在途读取。
let clientInflight: Promise<AuthUser | null> | null = null
let clientFetchedAt = 0
let clientReadVersion = 0
// Identity changes invalidate writes; ordinary read invalidation must not cancel login.
let clientIdentityVersion = 0
let clientPendingIdentity: number | null = null
let clientFetchController: AbortController | null = null

// SSR 阶段的 user 存在 event.context 上（请求级，跨请求隔离），不进 nuxt payload；
// 客户端阶段的 user 存在 useState 里。这样 SSR 输出的 HTML 永远不含 user 字段，
// 即便上游被加 public cache 也不会把 A 用户的身份串给 B 用户。
// 代价：依赖 user 的 UI 在 SSR 期间渲染为未登录态，必须配合 <ClientOnly> + fallback 使用。
interface AuthContext {
  authUser?: AuthUser | null
  authLoading?: boolean
}

export function useAuth() {
  // useRequestEvent 必须在 useAuth() 同步执行时调用并缓存：computed 的 getter/setter
  // 触发时机不保证在 Nuxt 实例上下文里（异步边界、外部 effect 求值都会丢上下文），
  // 那时再调 useRequestEvent() 会抛 "called outside of a plugin, Nuxt hook..."。
  const serverEvent = import.meta.server ? useRequestEvent() : null
  const serverCookieHeaders = import.meta.server ? useRequestHeaders(['cookie']) : undefined
  const getServerCtx = (): AuthContext | null => {
    return serverEvent ? (serverEvent.context as AuthContext) : null
  }

  const clientUser = !import.meta.server
    ? useState<AuthUser | null>('auth-user', () => null)
    : null
  const clientLoading = !import.meta.server
    ? useState<boolean>('auth-loading', () => false)
    : null

  const user = computed<AuthUser | null>({
    get() {
      if (import.meta.server) {
        return getServerCtx()?.authUser ?? null
      }
      return clientUser!.value
    },
    set(value) {
      if (import.meta.server) {
        const ctx = getServerCtx()
        if (ctx) ctx.authUser = value
        return
      }
      clientUser!.value = value
    }
  })

  const loading = computed<boolean>({
    get() {
      if (import.meta.server) {
        return getServerCtx()?.authLoading ?? false
      }
      return clientLoading!.value
    },
    set(value) {
      if (import.meta.server) {
        const ctx = getServerCtx()
        if (ctx) ctx.authLoading = value
        return
      }
      clientLoading!.value = value
    }
  })

  const runFetch = async () => {
    const requestVersion = clientReadVersion
    const controller = import.meta.client ? new AbortController() : null
    if (controller) clientFetchController = controller
    loading.value = true
    try {
      // 必须用 $fetch 而不是 useAsyncData / useFetch：后者会把响应写进 nuxt payload,
      // 一旦未来开了 getCachedData / payloadExtraction，A 用户的 user 信息会跟着 HTML 投递给 B 用户。
      const res = await $fetch<AuthUser | null>('/api/auth/me', {
        headers: serverCookieHeaders,
        signal: controller?.signal
      })
      if (import.meta.client && (requestVersion !== clientReadVersion || clientPendingIdentity !== null)) return user.value
      if (import.meta.client && user.value?.id !== res?.id) clientIdentityVersion += 1
      user.value = res ?? null
      if (import.meta.client) clientFetchedAt = Date.now()
      return user.value
    } catch (error) {
      if (import.meta.client && (requestVersion !== clientReadVersion || clientPendingIdentity !== null)) return user.value
      if (isAuthFailure(error)) {
        if (import.meta.client) clientIdentityVersion += 1
        user.value = null
        if (import.meta.client) clientFetchedAt = Date.now()
        return null
      }
      throw error
    } finally {
      if (!import.meta.client || requestVersion === clientReadVersion) loading.value = false
      if (clientFetchController === controller) clientFetchController = null
    }
  }

  const fetchMe = async (force = false) => {
    // 服务端：每次请求都重新评估登录态（中间件串行调用一次），dedup/TTL 都靠客户端兜
    if (import.meta.server) return runFetch()
    // A forced read promises a snapshot requested after the caller's mutation.
    // It cannot join a request which was already in flight before that mutation.
    if (force) invalidateClientFetch()
    const fresh = clientFetchedAt > 0 && Date.now() - clientFetchedAt < AUTH_FRESH_FOR_MS
    if (!force && fresh) return user.value
    if (clientInflight) return clientInflight
    const request = runFetch()
    clientInflight = request
    void request.then(
      () => { if (clientInflight === request) clientInflight = null },
      () => { if (clientInflight === request) clientInflight = null }
    )
    return request
  }

  const login = async (payload: LoginInput) => {
    const identityVersion = beginIdentityChange()
    if (import.meta.client) clientPendingIdentity = identityVersion
    try {
      const res = await $fetch<AuthUser>('/api/auth/login', {
        method: 'POST', body: payload
      })
      if (import.meta.client && identityVersion !== clientIdentityVersion) return res
      beginIdentityChange()
      user.value = res
      if (import.meta.client) clientFetchedAt = Date.now()
      return res
    } finally {
      if (import.meta.client && clientPendingIdentity === identityVersion) clientPendingIdentity = null
    }
  }

  const register = (payload: RegisterInput) => $fetch('/api/auth/register', {
    method: 'POST',
    body: payload
  })

  const logout = async () => {
    const identityVersion = beginIdentityChange()
    if (import.meta.client) clientPendingIdentity = identityVersion
    try {
      await $fetch('/api/auth/logout', { method: 'POST' })
      if (import.meta.client && identityVersion !== clientIdentityVersion) return
      beginIdentityChange()
      user.value = null
      if (import.meta.client) clientFetchedAt = Date.now()
    } finally {
      if (import.meta.client && clientPendingIdentity === identityVersion) clientPendingIdentity = null
    }
  }

  function invalidateClientFetch(): void {
    if (import.meta.server) return
    clientReadVersion += 1
    clientFetchedAt = 0
    clientFetchController?.abort()
    clientFetchController = null
    clientInflight = null
    loading.value = false
  }

  function beginIdentityChange(): number {
    if (import.meta.server) return clientIdentityVersion
    clientIdentityVersion += 1
    invalidateClientFetch()
    return clientIdentityVersion
  }

  function captureIdentity() {
    const id = user.value?.id
    const version = clientIdentityVersion
    return () => id !== undefined && user.value?.id === id
      && (!import.meta.client || (version === clientIdentityVersion && clientPendingIdentity === null))
  }

  const updateProfile = async (displayName: string): Promise<UserProfile | undefined> => {
    const isCurrent = captureIdentity()
    if (!isCurrent()) return
    invalidateClientFetch()
    try {
      const saved = await $fetch<UserProfile>('/api/user/profile', {
        method: 'PUT', body: { displayName: displayName.trim() }
      })
      if (!isCurrent() || saved.id !== user.value?.id) return
      invalidateClientFetch()
      // The mutation already returns the committed profile. Update only the
      // changed field; unrelated preferences may have been saved concurrently.
      user.value = { ...user.value!, displayName: saved.displayName }
      return saved
    } catch (error) {
      if (isCurrent()) throw error
    }
  }

  function isAuthFailure(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false
    const candidate = error as { status?: unknown, statusCode?: unknown }
    return candidate.status === 401
      || candidate.status === 403
      || candidate.statusCode === 401
      || candidate.statusCode === 403
  }

  const updateLocalePreference = async (locale: SupportedLocale) => {
    const isCurrent = captureIdentity()
    if (!isCurrent()) return
    invalidateClientFetch()
    try {
      const result = await $fetch('/api/user/preferences', {
        method: 'PUT', body: { locale }
      })
      if (!isCurrent()) return
      invalidateClientFetch()
      user.value = { ...user.value!, locale: result.locale }
      return result.locale
    } catch (error) {
      if (isCurrent()) throw error
    }
  }

  return {
    user,
    loading,
    fetchMe,
    login,
    register,
    logout,
    updateProfile,
    updateLocalePreference
  }
}
