import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { access, appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { archiveDistribution, packageRelease, restoreDistribution, verifyDistribution } from '../../../scripts/release/distribution.mjs'

let directory: string
let source: string
let artifact: string
const version = '0.1.5'
const sha = '1'.repeat(40)
const serviceSha = '2'.repeat(40)
const runtimeFiles = ['index.mjs', 'start.mjs', 'doctor.mjs', 'runtime-config.mjs', 'runtime-checks.mjs', 'pglite-client.mjs', 'migrate.mjs', 'database-migrator.mjs', 'db/migrations/postgresql/meta/_journal.json']

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'platform-distribution-test-'))
  source = join(directory, 'source')
  artifact = join(directory, 'artifact')
  for (const file of runtimeFiles) {
    const path = join(source, 'server', file)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, '{}')
  }
  await writeFile(join(source, 'package.json'), JSON.stringify({ version, scripts: {
    start: 'node server/start.mjs', migrate: 'node server/migrate.mjs', doctor: 'node server/doctor.mjs'
  } }))
})

afterEach(async () => {
  if (!resolve(directory).startsWith(resolve(tmpdir(), 'platform-distribution-test-'))) throw new Error('Unexpected cleanup directory')
  await rm(directory, { recursive: true, force: true })
})

describe('CI distribution packaging', () => {
  it('round-trips the tested server with commit, Service revision and checksum provenance', async () => {
    const metadata = await archiveDistribution({ source, destination: artifact, sha, serviceSha, version })
    const destination = join(directory, 'restored')
    await expect(restoreDistribution({ source: artifact, destination, sha, version })).resolves.toEqual(metadata)
    expect(metadata).toMatchObject({ sha, serviceSha, version, nodeMajor: 24 })
    expect(await readFile(join(destination, 'server/migrate.mjs'), 'utf8')).toBe('{}')
  })

  it('rejects corrupted archives before extracting them', async () => {
    await archiveDistribution({ source, destination: artifact, sha, serviceSha, version })
    await appendFile(join(artifact, 'ci-distribution.tar'), 'tampered')
    const destination = join(directory, 'restored')
    await expect(restoreDistribution({ source: artifact, destination, sha, version })).rejects.toThrow('checksum mismatch')
    await expect(access(destination)).rejects.toThrow()
  })

  it.each([{ sha: '3'.repeat(40), version }, { sha, version: '9.0.0' }])('rejects provenance mismatch %j', async (expected) => {
    await archiveDistribution({ source, destination: artifact, sha, serviceSha, version })
    await expect(restoreDistribution({ source: artifact, destination: join(directory, 'restored'), ...expected })).rejects.toThrow('metadata does not match')
  })

  it('rejects native addons before sharing an output across architectures', async () => {
    await writeFile(join(source, 'server/addon.node'), 'native')
    await expect(verifyDistribution(source, version)).rejects.toThrow('Native runtime file')
  })

  it('rejects a package with the wrong runtime entry point', async () => {
    await writeFile(join(source, 'package.json'), JSON.stringify({ version, scripts: { start: 'nuxt start' } }))
    await expect(verifyDistribution(source, version)).rejects.toThrow('runtime entry points')
  })

  it('requires the migration executable in a release', async () => {
    await rm(join(source, 'server/migrate.mjs'))
    await expect(verifyDistribution(source, version)).rejects.toThrow()
  })

  it('packages a flat deployable server with documentation and a matching checksum', async () => {
    const documents = join(directory, 'documents')
    await mkdir(documents)
    for (const file of ['.env.example', 'LICENSE', 'README.md', 'README_ZH.md']) await writeFile(join(documents, file), file)
    const destination = join(directory, 'release')
    const archive = await packageRelease({ source, destination, version, documents })
    const listing = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).split(/\r?\n/)
    expect(listing).toContain(`openapi-platform-${version}/server/migrate.mjs`)
    expect(listing).toContain(`openapi-platform-${version}/.env.example`)
    expect(listing.some(path => path.includes('/.output/'))).toBe(false)
    const checksum = createHash('sha256').update(await readFile(archive)).digest('hex')
    expect(await readFile(join(destination, 'checksums.txt'), 'utf8')).toBe(`${checksum}  openapi-platform-${version}.tar.gz\n`)
  })
})
