import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Worker } from 'node:worker_threads'
import { afterEach, describe, expect, it } from 'vitest'
import { LockedPGlite } from '../../../scripts/pglite-client.mjs'

const roots: string[] = []
const clients: LockedPGlite[] = []
const children: ChildProcess[] = []
const workers: Worker[] = []
const moduleUrl = pathToFileURL(resolve('scripts/pglite-client.mjs')).href

function directory() {
  const root = mkdtempSync(join(tmpdir(), 'openapi-pglite-lock-test-'))
  roots.push(root)
  return root
}

function open(path: string) {
  const client = new LockedPGlite(path)
  clients.push(client)
  return client
}

function holder(dataDir: string) {
  const code = `
    import { LockedPGlite } from ${JSON.stringify(moduleUrl)};
    try {
      const db = new LockedPGlite(process.argv[1]);
      await db.waitReady;
      console.log('LOCK_HELD');
      setInterval(() => {}, 1000);
    } catch (error) { console.error(error.code || error.message); process.exitCode = 1; }
  `
  const child = spawn(process.execPath, ['--input-type=module', '-e', code, dataDir], {
    windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']
  })
  children.push(child)
  return child
}

function exit(child: ChildProcess) {
  return new Promise<number | null>(resolveExit => child.once('exit', code => resolveExit(code)))
}

afterEach(async () => {
  await Promise.all(workers.splice(0).map(worker => worker.terminate()))
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      const stopped = exit(child)
      child.kill('SIGKILL')
      await stopped
    }
  }
  for (const client of clients.splice(0)) await client.close()
  for (const root of roots.splice(0)) {
    if (!resolve(root).startsWith(resolve(tmpdir(), 'openapi-pglite-lock-test-'))) throw new Error('Unexpected cleanup path')
    rmSync(root, { recursive: true, force: true })
  }
})

describe('PGlite exclusive access', () => {
  it('rejects another process and preserves the first connection and data', async () => {
    const root = directory()
    const db = open(root)
    await db.exec("create table lock_probe (value text); insert into lock_probe values ('original')")
    const child = holder(root)
    let errors = ''
    child.stderr?.on('data', chunk => { errors += String(chunk) })
    expect(await exit(child)).toBe(1)
    expect(errors).toContain('PGLITE_LOCKED')
    expect((await db.query('select value from lock_probe')).rows).toEqual([{ value: 'original' }])
    await db.close()
    const reopened = open(root)
    expect((await reopened.query('select value from lock_probe')).rows).toEqual([{ value: 'original' }])
  }, 15_000)

  it('uses the same lock for path aliases and releases only after close', async () => {
    const root = directory()
    const data = join(root, 'data')
    const alias = join(root, 'alias')
    const first = open(data)
    await first.waitReady
    symlinkSync(data, alias, process.platform === 'win32' ? 'junction' : 'dir')
    expect(() => open(alias)).toThrow('data directory is locked')
    await first.close()
    const second = open(alias)
    await second.waitReady
  }, 15_000)

  it('recovers a lock after its local owner has actually exited', async () => {
    const root = directory()
    const child = holder(root)
    await new Promise<void>((resolveReady, reject) => {
      child.stdout?.on('data', chunk => { if (String(chunk).includes('LOCK_HELD')) resolveReady() })
      child.once('exit', () => reject(new Error('Lock holder exited before readiness')))
      child.once('error', reject)
    })
    const stopped = exit(child)
    child.kill('SIGKILL')
    await stopped
    expect(existsSync(join(root, '.openapi-lock'))).toBe(true)
    const recovered = open(root)
    await recovered.waitReady
    await recovered.close()
    expect(existsSync(join(root, '.openapi-lock'))).toBe(false)
  }, 15_000)

  it('does not reclaim an owner from another host or PID namespace', () => {
    const root = directory()
    const lock = join(root, '.openapi-lock')
    mkdirSync(lock)
    const owner = join(lock, 'abcdef.json')
    const metadata = JSON.stringify({ pid: 1, host: 'unrelated-container', namespace: 'other' })
    writeFileSync(owner, metadata)
    expect(() => open(root)).toThrow('data directory is locked')
    expect(readFileSync(owner, 'utf8')).toBe(metadata)
  })

  it('waits for the previous Nitro worker to finish closing before opening the database', async () => {
    const root = directory()
    function worker() {
      const code = `
        const { parentPort, workerData } = require('node:worker_threads');
        import(workerData.moduleUrl).then(({ LockedPGlite }) => {
          let db;
          parentPort.on('message', async command => {
            try {
              if (command === 'open') {
                parentPort.postMessage('attempt');
                db = new LockedPGlite(workerData.root);
                await db.waitReady;
                parentPort.postMessage('opened');
              } else {
                await new Promise(resolve => setTimeout(resolve, 500));
                await db.close();
                parentPort.postMessage('closed');
              }
            } catch (error) { parentPort.postMessage({ error: error.message }); }
          });
          parentPort.postMessage('prepared');
        });
      `
      const instance = new Worker(code, { eval: true, workerData: { moduleUrl, root } })
      workers.push(instance)
      return instance
    }
    function message(worker: Worker, expected: string) {
      return new Promise<void>((resolveMessage, reject) => {
        function onMessage(value: string | { error: string }) {
          if (typeof value === 'object') { worker.off('message', onMessage); reject(new Error(value.error)) }
          if (value === expected) { worker.off('message', onMessage); resolveMessage() }
        }
        worker.on('message', onMessage)
        worker.once('error', reject)
      })
    }
    const previous = worker()
    await message(previous, 'prepared')
    const opened = message(previous, 'opened')
    previous.postMessage('open')
    await opened
    const replacement = worker()
    await message(replacement, 'prepared')
    const attempted = message(replacement, 'attempt')
    const replaced = message(replacement, 'opened')
    replacement.postMessage('open')
    await attempted
    const closed = message(previous, 'closed')
    previous.postMessage('close')
    await Promise.all([closed, replaced])
    const replacementClosed = message(replacement, 'closed')
    replacement.postMessage('close')
    await replacementClosed
    expect(existsSync(join(root, '.openapi-lock'))).toBe(false)
  }, 20_000)

  it('rejects incomplete databases without replacing data or leaving its own lock', () => {
    const root = directory()
    writeFileSync(join(root, 'PG_VERSION'), '18')
    expect(() => open(root)).toThrow('PGlite directory is incomplete')
    expect(readdirSync(root)).toEqual(['PG_VERSION'])
  })
})
