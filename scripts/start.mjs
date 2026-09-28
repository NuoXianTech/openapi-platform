import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  assertRuntimeConfiguration, assertSupportedNode, loadRuntimeEnvironment,
  resolveRuntimeRoot, runtimeAddress, runtimeUrl
} from './runtime-config.mjs'
import { assertPgliteDataDirectory, assertPortAvailable } from './runtime-checks.mjs'

try {
  assertSupportedNode()
  const root = resolveRuntimeRoot(import.meta.url)
  const entry = fs.existsSync(path.join(root, 'nuxt.config.ts'))
    ? path.join(root, '.output', 'server', 'index.mjs')
    : path.join(root, 'server', 'index.mjs')
  if (!fs.existsSync(entry)) throw new Error('Production build is missing. Run pnpm build first, or extract the complete release package.')
  const config = loadRuntimeEnvironment(root)
  assertRuntimeConfiguration(config.env)
  process.env.NODE_ENV = 'production'
  const address = runtimeAddress(config.env)
  process.env.NITRO_HOST = address.host
  process.env.NITRO_PORT = String(address.port)
  if (!config.env.DATABASE_URL?.trim()) assertPgliteDataDirectory(path.join(config.dataDir, 'pglite'))
  await assertPortAvailable(address)
  process.chdir(root)
  console.log(`[start] Configuration: ${config.envFile}`)
  console.log(`[start] Database: ${config.env.DATABASE_URL?.trim() ? 'PostgreSQL' : `PGlite ${config.dataDir}`}`)
  console.log(`[start] Starting ${runtimeUrl(address)}; readiness: /api/ready`)
  // Nitro's bundled migrator resolves its own files from the executable entry.
  // Preserve the same argv contract as `node server/index.mjs`.
  process.argv[1] = entry
  await import(pathToFileURL(entry).href)
} catch (error) {
  console.error(`[start] ${error.message}`)
  process.exitCode = 1
}
