import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const requiredFiles = [
  'package.json', 'server/index.mjs', 'server/start.mjs', 'server/doctor.mjs',
  'server/runtime-config.mjs', 'server/runtime-checks.mjs', 'server/pglite-client.mjs',
  'server/migrate.mjs', 'server/database-migrator.mjs', 'server/db/migrations/postgresql/meta/_journal.json'
]
const hash = bytes => createHash('sha256').update(bytes).digest('hex')

export async function verifyDistribution(directory, version) {
  for (const file of requiredFiles) await readFile(join(directory, file))
  const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'))
  if (manifest.version !== version || manifest.scripts?.start !== 'node server/start.mjs'
    || manifest.scripts?.migrate !== 'node server/migrate.mjs' || manifest.scripts?.doctor !== 'node server/doctor.mjs') {
    throw new Error('Distribution version or runtime entry points do not match')
  }
  // The same Nitro output is used on both native Linux runners. A future native
  // dependency requires architecture-specific builds instead of this contract.
  async function checkPortable(path) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      if (entry.isDirectory()) await checkPortable(join(path, entry.name))
      else if (/\.(node|dll|dylib|exe|so(?:\.\d+)*)$/i.test(entry.name)) throw new Error(`Native runtime file cannot be shared across architectures: ${entry.name}`)
    }
  }
  await checkPortable(directory)
}

export async function archiveDistribution({ source, destination, sha, serviceSha, version }) {
  await verifyDistribution(source, version)
  await mkdir(destination, { recursive: true })
  const archive = join(destination, 'ci-distribution.tar')
  execFileSync('tar', ['-cf', archive, '-C', source, '.'])
  const metadata = { schemaVersion: 1, sha, serviceSha, version, nodeMajor: 24, sha256: hash(await readFile(archive)) }
  await writeFile(join(destination, 'ci-build.json'), JSON.stringify(metadata, null, 2) + '\n')
  return metadata
}

export async function restoreDistribution({ source, destination, sha, version }) {
  const metadata = JSON.parse(await readFile(join(source, 'ci-build.json'), 'utf8'))
  if (metadata.schemaVersion !== 1 || metadata.sha !== sha || metadata.version !== version || metadata.nodeMajor !== 24) {
    throw new Error('CI distribution metadata does not match the requested commit and version')
  }
  const archive = join(source, 'ci-distribution.tar')
  if (hash(await readFile(archive)) !== metadata.sha256) throw new Error('CI distribution checksum mismatch')
  await mkdir(destination, { recursive: true })
  execFileSync('tar', ['-xf', archive, '-C', destination])
  await verifyDistribution(destination, version)
  return metadata
}

export async function packageRelease({ source, destination, version, documents }) {
  await verifyDistribution(source, version)
  const name = `openapi-platform-${version}`
  const directory = join(destination, name)
  await mkdir(directory, { recursive: true })
  await cp(source, directory, { recursive: true, verbatimSymlinks: true })
  for (const file of ['.env.example', 'LICENSE', 'README.md', 'README_ZH.md']) await cp(join(documents, file), join(directory, file))
  const archive = join(destination, `${name}.tar.gz`)
  execFileSync('tar', ['-czf', archive, '-C', destination, name])
  await writeFile(join(destination, 'checksums.txt'), `${hash(await readFile(archive))}  ${basename(archive)}\n`)
  return archive
}

async function main() {
  const [command, sourceArg, destinationArg] = process.argv.slice(2)
  if (!sourceArg || !destinationArg) throw new Error('Usage: distribution.mjs <archive|restore|package> <source> <destination>')
  const source = resolve(sourceArg)
  const destination = resolve(destinationArg)
  const version = JSON.parse(await readFile('package.json', 'utf8')).version
  const sha = process.env.EXPECTED_SHA ?? execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  if (command === 'archive') {
    const serviceSha = execFileSync('git', ['-C', 'openapi-service', 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
    await archiveDistribution({ source, destination, sha, serviceSha, version })
  } else if (command === 'restore') {
    await restoreDistribution({ source, destination, sha, version })
  } else if (command === 'package') {
    await packageRelease({ source, destination, version, documents: process.cwd() })
  } else throw new Error(`Unknown distribution command: ${command}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1 })
}
