import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

describe('application theme rendering', () => {
  it('keeps slot styles and root theme aligned across navigation and overlay outlets', () => {
    // Uses real Nuxt UI templates and theme merging. Only Nuxt environment and
    // DOM primitives are replaced by an in-memory renderer, not the theme logic.
    const output = execFileSync(process.execPath, ['test/helpers/app-theme-render.mjs'], { encoding: 'utf8' })
    expect(output).toContain('Actual App/UTheme/Modal/Slideover/Card rendering passed')
  })
})
