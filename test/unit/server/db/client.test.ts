import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ensurePgliteDataDir,
  getDatabaseDriver,
  resolvePgliteDataDir
} from '~~/server/db/client'

const tempRoots: string[] = []
const originalDatabaseUrl = process.env.DATABASE_URL

describe('database client utilities', () => {
  afterEach(() => {
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = originalDatabaseUrl

    for (const root of tempRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('creates nested filesystem directories for PGlite data', () => {
    const root = mkdtempSync(join(tmpdir(), 'openapi-pglite-'))
    tempRoots.push(root)

    const dataDir = join(root, 'nested', 'pglite')
    ensurePgliteDataDir(dataDir)

    expect(existsSync(dataDir)).toBe(true)
  })

  it('uses the fixed PGlite directory for blank overrides', () => {
    expect(resolvePgliteDataDir()).toBe(resolve('.data/pglite'))
    expect(resolvePgliteDataDir('')).toBe(resolve('.data/pglite'))
    expect(resolvePgliteDataDir('   ')).toBe(resolve('.data/pglite'))
    expect(resolvePgliteDataDir(' custom/pglite ')).toBe('custom/pglite')
  })

  it('selects PostgreSQL only when DATABASE_URL is present', () => {
    delete process.env.DATABASE_URL
    expect(getDatabaseDriver()).toBe('pglite')

    process.env.DATABASE_URL = '   '
    expect(getDatabaseDriver()).toBe('pglite')

    process.env.DATABASE_URL = 'postgresql://user:password@127.0.0.1:5432/openapi'
    expect(getDatabaseDriver()).toBe('postgres')
  })
})
