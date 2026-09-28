import fs, { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  assertLegacyDataSelected, assertSupportedNode, readRuntimeEnvironment,
  resolveRuntimeRoot, runtimeConfigurationErrors
} from '../../../scripts/runtime-config.mjs'
import { resolvePgliteDataDir as applicationDataDir } from '../../../server/db/client'
import { resolvePgliteDataDir as migrationDataDir } from '../../../scripts/database-migrator.mjs'
import { assertDataDirectoryWritable, assertPgliteDataDirectory } from '../../../scripts/runtime-checks.mjs'

const directories: string[] = []
function temporary() {
  const directory = mkdtempSync(join(tmpdir(), 'openapi-runtime-tools-'))
  directories.push(directory)
  return directory
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  for (const directory of directories.splice(0)) {
    if (!resolve(directory).startsWith(resolve(tmpdir(), 'openapi-runtime-tools-'))) throw new Error('Unexpected cleanup path')
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('shared runtime paths and precedence', () => {
  it('only reads configuration, including when secrets are absent or invalid', () => {
    const root = temporary()
    expect(runtimeConfigurationErrors(readRuntimeEnvironment(root, {}).env)).toHaveLength(2)
    expect(existsSync(join(root, '.env'))).toBe(false)
    const file = join(root, '.env')
    const contents = '# user-managed\nNUXT_AUTH_SECRET=custom-value\nNUXT_API_KEY_SECRET=custom-key\n'
    writeFileSync(file, contents)
    expect(runtimeConfigurationErrors(readRuntimeEnvironment(root, {}).env)).toHaveLength(2)
    expect(readFileSync(file, 'utf8')).toBe(contents)
  })

  it('resolves local source and .output commands to the same checkout', () => {
    const root = temporary()
    writeFileSync(join(root, 'nuxt.config.ts'), '')
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'openapi-platform' }))
    expect(resolveRuntimeRoot(pathToFileURL(join(root, 'scripts/start.mjs')).href)).toBe(root)
    expect(resolveRuntimeRoot(pathToFileURL(join(root, '.output/server/start.mjs')).href)).toBe(root)
    const release = join(root, 'release')
    expect(resolveRuntimeRoot(pathToFileURL(join(release, 'server/start.mjs')).href)).toBe(release)
  })

  it('uses process values over file values and resolves data beside an explicit env file', () => {
    const root = temporary()
    const shared = temporary()
    const file = join(shared, 'production.env')
    writeFileSync(file, 'DATABASE_URL=postgres://file@localhost/file\nPLATFORM_DATA_DIR=storage\nNITRO_PORT=3333\n')
    const config = readRuntimeEnvironment(root, { PLATFORM_ENV_FILE: file, DATABASE_URL: '', NITRO_PORT: '4444' })
    expect(config.env.DATABASE_URL).toBe('')
    expect(config.env.NITRO_PORT).toBe('4444')
    expect(config.dataDir).toBe(join(shared, 'storage'))
    vi.stubEnv('PLATFORM_DATA_DIR', config.dataDir)
    expect(applicationDataDir()).toBe(join(shared, 'storage/pglite'))
    expect(migrationDataDir()).toBe(applicationDataDir())
  })

  it('does not silently abandon a legacy .output database', () => {
    const root = temporary()
    mkdirSync(join(root, '.output/.data/pglite'), { recursive: true })
    writeFileSync(join(root, '.output/.data/pglite/PG_VERSION'), '17')
    expect(() => assertLegacyDataSelected(readRuntimeEnvironment(root, {}))).toThrow('Existing PGlite data')
    expect(() => assertLegacyDataSelected(readRuntimeEnvironment(root, { PLATFORM_DATA_DIR: 'restored-data' }))).not.toThrow()
  })

  it('reports a missing explicit env file instead of falling back', () => {
    const root = temporary()
    expect(() => readRuntimeEnvironment(root, { PLATFORM_ENV_FILE: join(root, 'missing.env') })).toThrow('does not exist')
  })

  it('requires explicit selection when a legacy .output environment exists', () => {
    const root = temporary()
    mkdirSync(join(root, '.output'))
    const legacy = join(root, '.output/.env')
    writeFileSync(legacy, 'DATABASE_URL=postgres://user@localhost/legacy\n')
    expect(() => readRuntimeEnvironment(root, {})).toThrow('Legacy configuration')
    expect(existsSync(join(root, '.env'))).toBe(false)
    expect(readRuntimeEnvironment(root, { PLATFORM_ENV_FILE: legacy }).env.DATABASE_URL).toContain('/legacy')
  })

  it('aggregates configuration errors without echoing credentials', () => {
    const errors = runtimeConfigurationErrors({ DATABASE_URL: 'https://user:do-not-log@localhost/db' })
    expect(errors).toHaveLength(3)
    expect(errors.join(' ')).not.toContain('do-not-log')
    expect(() => assertSupportedNode('22.1.0')).toThrow('Node.js 24 is required')
  })

  it('fails promptly for an unavailable drive or filesystem root', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(false)
    expect(() => assertDataDirectoryWritable(resolve('missing-drive/data'))).toThrow('no accessible parent')
  })

  it('checks the actual database path and leaves missing paths untouched', () => {
    const root = temporary()
    const missing = join(root, 'new', 'pglite')
    expect(() => assertPgliteDataDirectory(missing)).not.toThrow()
    expect(existsSync(missing)).toBe(false)
    const file = join(root, 'pglite')
    writeFileSync(file, 'not a directory')
    expect(() => assertPgliteDataDirectory(file)).toThrow('not a directory')
  })

  it('rejects incomplete existing data without recreating missing directories', () => {
    const root = temporary()
    writeFileSync(join(root, 'PG_VERSION'), '18')
    expect(() => assertPgliteDataDirectory(root)).toThrow('pg_notify')
    expect(existsSync(join(root, 'pg_notify'))).toBe(false)
    expect(readFileSync(join(root, 'PG_VERSION'), 'utf8')).toBe('18')
  })
})
