import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as nodeUtil from 'node:util'

export function assertSupportedNode(version = process.versions.node) {
  if (Number(version.split('.')[0]) !== 24) {
    throw new Error(`Node.js 24 is required (current: ${version}). Install Node.js 24 and retry.`)
  }
}

export function resolveRuntimeRoot(scriptUrl) {
  const root = path.resolve(path.dirname(fileURLToPath(scriptUrl)), '..')
  // A local .output belongs to its source checkout. An extracted release or
  // container has its own root and never searches arbitrary parent .env files.
  if (path.basename(root) === '.output' && fs.existsSync(path.join(root, '..', 'nuxt.config.ts'))) {
    try {
      const manifest = JSON.parse(fs.readFileSync(path.join(root, '..', 'package.json'), 'utf8'))
      if (manifest.name === 'openapi-platform') return path.dirname(root)
    } catch { /* Standalone artifacts do not need a parent source checkout. */ }
  }
  return root
}

export function readRuntimeEnvironment(root, inherited = process.env) {
  const explicitEnvFile = inherited.PLATFORM_ENV_FILE?.trim()
  const legacyEnvFile = path.join(root, '.output', '.env')
  if (!explicitEnvFile && fs.existsSync(legacyEnvFile)) {
    throw new Error(`Legacy configuration found at ${legacyEnvFile}. Set PLATFORM_ENV_FILE explicitly to select the intended configuration before continuing.`)
  }
  const envFile = explicitEnvFile
    ? path.resolve(explicitEnvFile)
    : path.join(root, '.env')
  if (explicitEnvFile && !fs.existsSync(envFile)) {
    throw new Error(`PLATFORM_ENV_FILE does not exist: ${envFile}`)
  }
  const fileValues = fs.existsSync(envFile)
    ? nodeUtil.parseEnv(fs.readFileSync(envFile, 'utf8'))
    : {}
  const env = { ...fileValues, ...inherited }
  const dataDir = path.resolve(path.dirname(envFile), env.PLATFORM_DATA_DIR?.trim() || '.data')
  return { root, envFile, fileValues, explicitDataDir: Boolean(env.PLATFORM_DATA_DIR?.trim()), env: { ...env, PLATFORM_DATA_DIR: dataDir }, dataDir }
}

function directoryHasData(directory) {
  return fs.existsSync(directory) && fs.readdirSync(directory).length > 0
}

export function assertLegacyDataSelected(config) {
  if (config.explicitDataDir) return
  const legacy = path.join(config.root, '.output', '.data', 'pglite')
  if (!config.env.DATABASE_URL?.trim() && directoryHasData(legacy)) {
    throw new Error(`Existing PGlite data found at ${legacy}. Back it up and set PLATFORM_DATA_DIR explicitly before starting; data is never moved automatically.`)
  }
}

export function loadRuntimeEnvironment(root) {
  const config = readRuntimeEnvironment(root)
  assertLegacyDataSelected(config)
  for (const [key, value] of Object.entries(config.env)) {
    if (value !== undefined) process.env[key] = value
  }
  return config
}

export function resolvePgliteDataDir(dataDir) {
  return dataDir?.trim() || path.resolve(process.env.PLATFORM_DATA_DIR?.trim() || '.data', 'pglite')
}

export function parseApiKeySecret(raw) {
  if (!raw) throw new Error('NUXT_API_KEY_SECRET is required')
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, 'hex')
  const decoded = Buffer.from(raw, 'base64url')
  if (decoded.length === 32) return decoded
  const utf8 = Buffer.from(raw, 'utf8')
  if (utf8.length === 32) return utf8
  throw new Error('NUXT_API_KEY_SECRET must be 32 bytes (hex / base64url / utf-8)')
}

export function runtimeConfigurationErrors(env) {
  const errors = []
  if (Buffer.byteLength(env.NUXT_AUTH_SECRET || '', 'utf8') < 32) {
    errors.push('NUXT_AUTH_SECRET must contain at least 32 bytes')
  }
  try { parseApiKeySecret(env.NUXT_API_KEY_SECRET) } catch (error) { errors.push(error.message) }
  if (env.NUXT_AUTH_SECRET && env.NUXT_AUTH_SECRET === env.NUXT_API_KEY_SECRET) {
    errors.push('NUXT_AUTH_SECRET and NUXT_API_KEY_SECRET must be different')
  }
  for (const [key, protocols] of [
    ['DATABASE_URL', ['postgres:', 'postgresql:']],
    ['NUXT_REDIS_URL', ['redis:', 'rediss:']]
  ]) {
    if (!env[key]?.trim()) continue
    try {
      const url = new URL(env[key])
      if (!protocols.includes(url.protocol) || !url.hostname
        || (key === 'DATABASE_URL' && url.pathname.length < 2)) throw new Error()
    } catch { errors.push(`${key} must be a valid ${protocols.join('/')} connection URL`) }
  }
  return errors
}

export function assertRuntimeConfiguration(env) {
  const errors = runtimeConfigurationErrors(env)
  if (errors.length) throw new Error(`Configuration needs attention:\n${errors.map(error => `- ${error}`).join('\n')}\nSet these values in your .env file or process environment, then retry.`)
}

export function runtimeAddress(env) {
  const raw = env.NITRO_PORT || env.PORT || '3000'
  const port = Number(raw)
  if (!/^\d+$/.test(raw) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('NITRO_PORT must be an integer between 1 and 65535')
  }
  return { host: env.NITRO_HOST || env.HOST || '127.0.0.1', port }
}

export function runtimeUrl({ host, port }) {
  const connectHost = host === '0.0.0.0' ? '127.0.0.1' : host === '::' ? '::1' : host
  return `http://${connectHost.includes(':') ? `[${connectHost}]` : connectHost}:${port}`
}
