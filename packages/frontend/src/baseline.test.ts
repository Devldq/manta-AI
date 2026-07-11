import { describe, expect, it } from 'vitest'
import { getThemeById } from './lib/theme-presets'

describe('configured themes', () => {
  it('resolves the CLI Pixel theme', () => {
    expect(getThemeById('cli-pixel')).toBeDefined()
  })
})
