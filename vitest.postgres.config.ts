import { defineConfig } from 'vitest/config'
import base from './vitest.config.ts'

if (!process.env.TEST_POSTGRES_URL?.trim()) {
  throw new Error('TEST_POSTGRES_URL must point to a test PostgreSQL instance with CREATE DATABASE permission')
}

export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: ['test/unit/server/services/upstream-deletion-concurrency.test.ts'],
    maxWorkers: 1,
    testTimeout: 20_000,
    hookTimeout: 30_000
  }
})
