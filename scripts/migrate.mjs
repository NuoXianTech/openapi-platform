import { assertSupportedNode, loadRuntimeEnvironment, resolveRuntimeRoot } from './runtime-config.mjs'

let migrationStarted = false
try {
  assertSupportedNode()
  const root = resolveRuntimeRoot(import.meta.url)
  const config = loadRuntimeEnvironment(root)
  process.chdir(root)
  console.log(`[db:migrate] Configuration: ${config.envFile}`)
  const { runDatabaseMigrations } = await import('./database-migrator.mjs')
  migrationStarted = true
  await runDatabaseMigrations()
} catch (error) {
  // Driver errors can contain connection strings. The detailed driver code is
  // useful without echoing an environment file's password into terminal logs.
  if (['MIGRATION_HISTORY_MISMATCH', 'PGLITE_LOCKED'].includes(error.code)) {
    console.error(`[db:migrate] ${error.message}`)
  } else if (migrationStarted) {
    console.error('[db:migrate] Migration failed. Check configuration, data permissions and migration compatibility.', { code: error.code ?? 'MIGRATION_FAILED' })
  } else console.error(`[db:migrate] ${error.message}`)
  process.exitCode = 1
}
