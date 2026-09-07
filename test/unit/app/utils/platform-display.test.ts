import { describe, expect, it } from 'vitest'
import { shortServiceCommit } from '@/utils/platform-display'

describe('shortServiceCommit', () => {
  it.each([
    ['a1b2c3d4'.repeat(5), 'a1b2c3d'],
    ['ABCDEF01'.repeat(8), 'ABCDEF0'],
    ['  12345678  ', '1234567'],
    ['a1b2c3d', 'a1b2c3d'],
    ['unknown', 'unknown'],
    ['local', 'local'],
    [null, '—'],
    [undefined, '—'],
    ['', '—'],
    ['   ', '—']
  ])('formats %s as %s', (value, expected) => {
    expect(shortServiceCommit(value)).toBe(expected)
  })
})
