import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  assertSupportedNode, assertLegacyDataSelected, readRuntimeEnvironment,
  resolveRuntimeRoot, runtimeAddress, runtimeConfigurationErrors, runtimeUrl
} from './runtime-config.mjs'
import {
  assertPgliteDataDirectory, isPortAvailable, checkPostgres, checkRedis, checkReadiness
} from './runtime-checks.mjs'

export async function diagnose(root) {
  const checks = []
  const record = (name, status, message) => checks.push({ name, status, message })
  try { assertSupportedNode(); record('node', 'ok', process.versions.node) } catch (error) { record('node', 'error', error.message) }
  const source = fs.existsSync(path.join(root, 'nuxt.config.ts'))
  const artifact = path.join(root, source ? '.output/server/index.mjs' : 'server/index.mjs')
  record('build', fs.existsSync(artifact) ? 'ok' : 'warn', fs.existsSync(artifact) ? 'Production build exists' : 'Run pnpm build before pnpm start; development is available without a build')
  if (source) {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
    // Do not execute a pnpm/Corepack shim: it may download a package manager.
    const runningVersion = /(?:^|\s)pnpm\/([^\s]+)/.exec(process.env.npm_config_user_agent || '')?.[1]
    const matches = `pnpm@${runningVersion}` === manifest.packageManager
    record('pnpm', matches ? 'ok' : 'warn', matches ? manifest.packageManager : `Required: ${manifest.packageManager}. Install/check pnpm manually; this command never installs tools.`)
    record('dependencies', fs.existsSync(path.join(root, 'node_modules', 'nuxt')) ? 'ok' : 'error', fs.existsSync(path.join(root, 'node_modules', 'nuxt')) ? 'Installed' : 'Run pnpm install --frozen-lockfile manually')
  }
  let config
  try {
    config = readRuntimeEnvironment(root)
    record('configuration-file', fs.existsSync(config.envFile) ? 'ok' : 'warn', fs.existsSync(config.envFile) ? config.envFile : `${config.envFile} is absent; using process environment`)
    const errors = runtimeConfigurationErrors(config.env)
    record('configuration', errors.length ? 'error' : 'ok', errors.length ? errors.join('; ') : 'Required values are valid (secrets hidden)')
    assertLegacyDataSelected(config)
  } catch (error) { record('configuration', 'error', error.message) }
  if (config) {
    if (config.env.DATABASE_URL?.trim()) {
      try {
        await checkPostgres(config.env.DATABASE_URL)
        record('database', 'ok', 'PostgreSQL connection and SELECT 1 succeeded')
      } catch { record('database', 'error', 'PostgreSQL connection failed; check the URL, credentials, TLS, and network') }
    } else {
      try {
        const databaseDir = path.join(config.dataDir, 'pglite')
        assertPgliteDataDirectory(databaseDir)
        record('database', 'ok', `PGlite: ${databaseDir} (path and basic structure checked; no database opened)`)
      } catch (error) { record('database', 'error', error.message) }
    }
    if (config.env.NUXT_REDIS_URL?.trim()) {
      try { await checkRedis(config.env.NUXT_REDIS_URL); record('redis', 'ok', 'Redis PING succeeded') } catch {
        record('redis', 'error', 'Redis connection failed; configured Redis is required for coordination')
      }
    } else record('redis', 'ok', 'Not configured; single-process mode')
    try {
      const address = runtimeAddress(config.env)
      const ready = await checkReadiness(address)
      if (ready) record('readiness', 'ok', `${runtimeUrl(address)}/api/ready is ready`)
      else if (await isPortAvailable(address)) record('readiness', 'warn', 'Application is not running; the configured port is available')
      else record('readiness', 'error', 'Port is occupied but readiness failed; inspect the running process and its logs')
    } catch { record('readiness', 'error', 'Invalid or unavailable listening address; check NITRO_HOST and NITRO_PORT') }
  }
  return { ok: checks.every(check => check.status !== 'error'), checks }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.slice(2).some(arg => arg !== '--json')) throw new Error('Usage: node scripts/doctor.mjs [--json]')
    const result = await diagnose(resolveRuntimeRoot(import.meta.url))
    if (process.argv.includes('--json')) console.log(JSON.stringify(result, null, 2))
    else for (const check of result.checks) console.log(`[${check.status.toUpperCase()}] ${check.name}: ${check.message}`)
    process.exitCode = result.ok ? 0 : 1
  } catch (error) {
    console.error(`[doctor] ${error.message}`)
    process.exitCode = 1
  }
}
