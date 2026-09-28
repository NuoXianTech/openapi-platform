import fs from 'node:fs'
import path from 'node:path'
import { hostname } from 'node:os'
import { randomUUID } from 'node:crypto'
import { isMainThread, threadId } from 'node:worker_threads'
import { PGlite } from '@electric-sql/pglite'
import { assertPgliteDataDirectory } from './runtime-checks.mjs'

function processIdentity() {
  // PID numbers in different containers are not comparable.
  const namespace = process.platform === 'linux'
    ? `${fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim()}:${fs.readlinkSync('/proc/self/ns/pid')}`
    : process.platform
  return { pid: process.pid, threadId, host: hostname(), namespace }
}

function acquireDataLock(dataDir) {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(dataDir)) return () => {}
  fs.mkdirSync(path.resolve(dataDir), { recursive: true })
  const lockDir = path.join(fs.realpathSync(dataDir), '.openapi-lock')
  const identity = processIdentity()
  const ownerName = `${randomUUID()}.json`
  const occupied = () => Object.assign(new Error(`PGlite data directory is locked: ${lockDir}. Stop the other Platform or migration process. If the owner cannot be identified, verify all users of this directory are stopped before removing this lock directory.`), { code: 'PGLITE_LOCKED' })

  function create() {
    fs.mkdirSync(lockDir)
    try {
      fs.writeFileSync(path.join(lockDir, ownerName), JSON.stringify(identity), { flag: 'wx' })
    } catch (error) {
      // Do not remove an uncertain/partially written lock automatically.
      throw new Error(`Cannot write PGlite lock owner at ${lockDir}. Check permissions and remove the lock only after stopping all database users.`, { cause: error })
    }
  }

  try { create() } catch (error) {
    if (error.code !== 'EEXIST') throw error
    // A unique owner filename lets competing recoveries unlink only the old
    // owner's file. Never recursively remove a lock: a new owner may be there.
    const entries = fs.readdirSync(lockDir)
    if (entries.length !== 1 || !/^[\da-f-]+\.json$/.test(entries[0])) throw occupied()
    const oldFile = path.join(lockDir, entries[0])
    let owner
    try { owner = JSON.parse(fs.readFileSync(oldFile, 'utf8')) } catch { throw occupied() }
    if (owner.host !== identity.host || owner.namespace !== identity.namespace
      || !Number.isSafeInteger(owner.pid) || owner.pid < 1) throw occupied()
    if (!isMainThread && owner.pid === process.pid && Number.isInteger(owner.threadId) && owner.threadId !== threadId) {
      throw Object.assign(occupied(), { workerHandoff: true })
    }
    try { process.kill(owner.pid, 0); throw occupied() } catch (error) {
      if (error.code !== 'ESRCH') throw occupied()
    }
    try {
      fs.unlinkSync(oldFile)
      fs.rmdirSync(lockDir)
      create()
    } catch { throw occupied() }
  }

  let released = false
  return () => {
    if (released) return
    fs.unlinkSync(path.join(lockDir, ownerName))
    fs.rmdirSync(lockDir)
    released = true
  }
}

// Both the app and the standalone migrator must use this client. Acquire before
// PGlite touches disk and keep the lock until its final writes have completed.
export class LockedPGlite extends PGlite {
  #release

  constructor(dataDir) {
    let release
    const deadline = Date.now() + 5000
    while (!release) {
      try { release = acquireDataLock(dataDir) } catch (error) {
        if (!error.workerHandoff || Date.now() >= deadline) throw error
        // Nitro starts the replacement worker before the old worker's async
        // close completes. Block only the new worker, never the closing one.
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25)
      }
    }
    try {
      const filesystem = !/^[a-z][a-z0-9+.-]*:\/\//i.test(dataDir)
      const canonical = filesystem ? fs.realpathSync(dataDir) : dataDir
      if (filesystem) assertPgliteDataDirectory(canonical)
      super(canonical)
    } catch (error) { release(); throw error }
    this.#release = release
    void this.waitReady.catch(() => release())
  }

  async close() {
    await this.waitReady.catch(() => {})
    if (this.ready && !this.closed) await super.close()
    this.#release()
  }
}
