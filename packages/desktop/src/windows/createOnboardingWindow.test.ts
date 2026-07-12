import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('createOnboardingWindow', () => {
  it('pins all top-level navigation and redirects to the canonical onboarding URL', async () => {
    const source = await readFile(resolve(__dirname, 'createOnboardingWindow.ts'), 'utf8')

    expect(source).toContain("webContents.on('will-navigate'")
    expect(source).toContain("webContents.on('will-frame-navigate'")
    expect(source).toContain("webContents.on('will-redirect'")
    expect(source).toContain('event.preventDefault()')
    expect(source).toContain('onboardingPageUrl')
  })
})
