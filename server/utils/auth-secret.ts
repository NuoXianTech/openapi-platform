import { parseAuthSecret } from '../../scripts/runtime-config.mjs'

let cachedAuthSecret: string | undefined

export function getAuthSecret(): string {
  if (cachedAuthSecret) return cachedAuthSecret

  cachedAuthSecret = parseAuthSecret(useRuntimeConfig().auth.secret as string)
  return cachedAuthSecret
}
