import fs from 'node:fs'
import path from 'node:path'
import { createServer } from 'node:net'
import { runtimeUrl } from './runtime-config.mjs'

export function assertDataDirectoryWritable(dataDir) {
  let directory = dataDir
  while (!fs.existsSync(directory)) {
    const parent = path.dirname(directory)
    if (parent === directory) throw new Error(`Data path has no accessible parent: ${dataDir}`)
    directory = parent
  }
  if (!fs.statSync(directory).isDirectory()) throw new Error(`Data path is not a directory: ${directory}`)
  try { fs.accessSync(directory, fs.constants.W_OK) } catch {
    throw new Error(`Data directory is not writable: ${directory}`)
  }
}

export function assertPgliteDataDirectory(dataDir) {
  assertDataDirectoryWritable(dataDir)
  if (!fs.existsSync(dataDir)) return
  const entries = fs.readdirSync(dataDir).filter(name => name !== '.openapi-lock')
  if (entries.length === 0) return
  const requiredDirectories = [
    'base', 'global', 'pg_wal', 'pg_xact', 'pg_multixact', 'pg_subtrans',
    'pg_notify', 'pg_serial', 'pg_snapshots', 'pg_twophase', 'pg_tblspc',
    'pg_replslot', 'pg_dynshmem', 'pg_commit_ts', 'pg_logical', 'pg_stat'
  ]
  const missing = []
  for (const name of ['PG_VERSION', 'global/pg_control', ...requiredDirectories]) {
    const target = path.join(dataDir, name)
    const stat = fs.statSync(target, { throwIfNoEntry: false })
    const directory = requiredDirectories.includes(name)
    if (!stat || (directory ? !stat.isDirectory() : !stat.isFile() || stat.size === 0)) missing.push(name)
  }
  if (missing.length) {
    throw new Error(`PGlite directory is incomplete: ${dataDir}. Missing or invalid: ${missing.join(', ')}. Stop the application and verify a complete backup; no database files were repaired or replaced.`)
  }
}

export async function isPortAvailable({ host, port }) {
  return await new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', error => error.code === 'EADDRINUSE' ? resolve(false) : reject(error))
    server.listen(port, host, () => server.close(() => resolve(true)))
  })
}

export async function assertPortAvailable(address) {
  if (!await isPortAvailable(address)) {
    throw new Error(`Port ${address.port} is already in use. Stop the existing process or set NITRO_PORT to another port.`)
  }
}

export async function checkPostgres(databaseUrl) {
  // Use the same ESM entry as Nitro. Its deployment tracing does not include
  // the alternative CommonJS entry of every dependency.
  const { default: postgres } = await import('postgres')
  const client = postgres(databaseUrl, { max: 1, connect_timeout: 3, connection: { statement_timeout: 3000 } })
  try { await client`select 1` } finally { await client.end({ timeout: 1 }) }
}

export async function checkRedis(redisUrl) {
  const { default: Redis } = await import('ioredis')
  const client = new Redis(redisUrl, {
    lazyConnect: true, connectTimeout: 3000, commandTimeout: 3000,
    retryStrategy: () => null, enableOfflineQueue: false
  })
  client.on('error', () => {})
  try { await client.connect(); await client.ping() } finally { client.disconnect() }
}

export async function checkReadiness(address) {
  try {
    const response = await fetch(`${runtimeUrl(address)}/api/ready`, { signal: AbortSignal.timeout(2000) })
    const body = await response.json()
    return response.ok && body.ready === true
  } catch { return false }
}
