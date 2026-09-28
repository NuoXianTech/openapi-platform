import { afterEach, describe, expect, it, vi } from 'vitest'
import { runtimeConfigurationErrors } from '../../../../scripts/runtime-config.mjs'
import { assertRuntimeEnvironment, getRuntimeEnvironmentErrors } from '~~/server/config/runtime-env'

afterEach(() => vi.unstubAllGlobals())
const authSecret = 'valid-auth-secret-with-at-least-32-bytes'
const apiKeySecret = '0123456789abcdef0123456789abcdef'

describe('runtime secret validation across input adapters', () => {
  it.each([
    { name: 'valid', authSecret, apiKeySecret, count: 0 },
    { name: 'missing', authSecret: '', apiKeySecret: '', count: 2 },
    { name: 'short authentication secret', authSecret: 'short', apiKeySecret, count: 1 },
    { name: 'invalid data key', authSecret, apiKeySecret: 'short', count: 1 },
    { name: 'identical secrets', authSecret: apiKeySecret, apiKeySecret, count: 1 },
    { name: 'utf8 byte length', authSecret: '密'.repeat(11), apiKeySecret, count: 0 },
    { name: 'hex data key', authSecret, apiKeySecret: 'a'.repeat(64), count: 0 },
    { name: 'base64url data key', authSecret, apiKeySecret: Buffer.alloc(32, 7).toString('base64url'), count: 0 }
  ])('uses identical rules for $name', (input) => {
    vi.stubGlobal('useRuntimeConfig', () => ({ auth: { secret: input.authSecret }, apiKeySecret: input.apiKeySecret }))
    const cliErrors = runtimeConfigurationErrors({ NUXT_AUTH_SECRET: input.authSecret, NUXT_API_KEY_SECRET: input.apiKeySecret })
    expect(cliErrors).toHaveLength(input.count)
    expect(getRuntimeEnvironmentErrors()).toEqual(cliErrors)
    if (input.count === 0) expect(() => assertRuntimeEnvironment()).not.toThrow()
    else expect(() => assertRuntimeEnvironment()).toThrow('Invalid runtime environment:')
  })
})
