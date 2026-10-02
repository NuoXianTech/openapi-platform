import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import { vueSetupPlugin } from './test/helpers/vue-setup-plugin.ts'

const rootDir = fileURLToPath(new URL('.', import.meta.url))
const appDir = fileURLToPath(new URL('./app', import.meta.url))
const sharedDir = fileURLToPath(new URL('./shared', import.meta.url))

const aliases = {
  '~~': rootDir,
  '@@': rootDir,
  '~': appDir,
  '@': appDir,
  '#shared': sharedDir,
  '#components': fileURLToPath(new URL('./test/helpers/overlay-components.ts', import.meta.url))
}

export default defineConfig({
  plugins: [vueSetupPlugin()],
  test: {
    environment: 'node',
    include: ['test/unit/**/*.{test,spec}.ts'],
    // Several database suites load PGlite's WASM runtime. Unbounded workers can
    // exhaust memory on high-core development and CI machines.
    maxWorkers: 2
  },
  resolve: {
    alias: aliases
  }
})
