import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'test/integration/database-migration-artifact.test.ts',
      'test/integration/runtime-start.test.ts',
      'test/integration/server-routes.test.ts'
    ],
    fileParallelism: false
  }
})
