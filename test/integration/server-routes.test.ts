import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fetch, setup, useTestContext } from '@nuxt/test-utils/e2e'
import { describe, expect, it } from 'vitest'

interface OpenApiErrorResponse {
  code: string
  message: string
  data: unknown
  timestamp: number
}

interface ReadinessResponse {
  ready: boolean
  database: {
    ready: boolean
  }
}

interface I18nMessagesResponse {
  'zh-CN': {
    common: {
      dashboard: {
        navigation: {
          contentManagement: string
        }
      }
    }
  }
}

const projectRoot = fileURLToPath(new URL('../..', import.meta.url))
const testWorkingDirectory = await mkdtemp(join(tmpdir(), 'openapi-integration-workspace-'))
const serverPort = 30_000 + process.pid % 10_000

process.chdir(testWorkingDirectory)

await setup({
  rootDir: projectRoot,
  build: false,
  browser: false,
  port: serverPort,
  nuxtConfig: {
    nitro: {
      output: { dir: join(projectRoot, '.output') }
    }
  },
  env: {
    NODE_ENV: 'production',
    NITRO_HOST: '127.0.0.1',
    NITRO_PORT: String(serverPort),
    DATABASE_URL: '',
    DB_AUTO_MIGRATE: 'true',
    NUXT_AUTH_SECRET: 'integration-auth-secret-with-32-bytes',
    NUXT_API_KEY_SECRET: '0123456789abcdef0123456789abcdef'
  }
})

useTestContext().teardown?.push(async () => {
  await rm(testWorkingDirectory, { recursive: true, force: true })
  process.chdir(projectRoot)
})

async function readJson<T>(response: Response): Promise<T> {
  return await response.json() as T
}

describe('Nitro server routes', () => {
  it('serves liveness and readiness probes', async () => {
    const healthResponse = await fetch('/api/health')
    const readinessResponse = await fetch('/api/ready')
    const readiness = await readJson<ReadinessResponse>(readinessResponse)

    expect(healthResponse.status).toBe(200)
    await expect(readJson<{ ok: boolean }>(healthResponse)).resolves.toMatchObject({ ok: true })
    expect(readinessResponse.status).toBe(200)
    expect(readiness).toMatchObject({
      ready: true,
      database: { ready: true }
    })
    expect(readinessResponse.headers.get('cache-control')).toBe('no-store')
  })

  it('keeps public API 404 responses on the documented contract', async () => {
    for (const path of ['/v1/not-found', '/weather-not-found']) {
      const response = await fetch(path)
      const body = await readJson<OpenApiErrorResponse>(response)

      expect(response.status).toBe(404)
      expect(body).toMatchObject({
        code: 'API_NOT_FOUND',
        message: '接口不存在',
        data: null
      })
      expect(body.timestamp).toEqual(expect.any(Number))
      expect(response.headers.get('x-request-id')).toBeTruthy()
    }
  })

  it('serves lazy-loaded locale messages outside the dynamic Gateway', async () => {
    const response = await fetch('/_i18n/integration/zh-CN/messages.json')
    const messages = await readJson<I18nMessagesResponse>(response)

    expect(response.status).toBe(200)
    expect(messages['zh-CN'].common.dashboard.navigation.contentManagement).toBe('内容管理')
  })

  it('does not expose standalone Route management APIs', async () => {
    const routeId = '11111111-1111-4111-8111-111111111111'
    for (const method of ['GET', 'POST', 'PATCH', 'DELETE'] as const) {
      const path = method === 'PATCH' || method === 'DELETE'
        ? `/api/admin/v1/routes/${routeId}`
        : '/api/admin/v1/routes'
      const response = await fetch(path, { method })
      expect(response.status).toBe(404)
    }
  })

  it('applies production security headers without disclosing the server stack', async () => {
    const apiResponse = await fetch('/api/health')
    const documentResponse = await fetch('/')

    expect(apiResponse.headers.get('x-content-type-options')).toBe('nosniff')
    expect(apiResponse.headers.get('strict-transport-security')).toContain('max-age=31536000')
    expect(apiResponse.headers.has('content-security-policy')).toBe(false)
    expect(apiResponse.headers.has('permissions-policy')).toBe(false)
    expect(apiResponse.headers.has('x-powered-by')).toBe(false)

    expect(documentResponse.headers.get('content-security-policy')).toContain(`frame-ancestors 'none'`)
    expect(documentResponse.headers.get('permissions-policy')).toContain('camera=()')
    expect(documentResponse.headers.get('x-frame-options')).toBe('DENY')
  })
})
