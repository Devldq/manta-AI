import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('onboarding preload contract', () => {
  it('exposes four actions plus one validated progress subscription', async () => {
    const source = await readFile(resolve(__dirname, 'onboarding-preload.ts'), 'utf8')
    expect(source.match(/ipcRenderer\.invoke\(/g)).toHaveLength(4)
    expect(source).toContain("state: () => ipcRenderer.invoke('onboarding:state')")
    expect(source).toContain("selectParent: () => ipcRenderer.invoke('onboarding:select-parent')")
    expect(source).toContain("initialize: (selectionId: string) => ipcRenderer.invoke('onboarding:initialize', { selectionId })")
    expect(source).toContain("quit: () => ipcRenderer.invoke('onboarding:quit')")
    expect(source).toContain("ipcRenderer.on('onboarding:progress'")
    expect(source).toContain("ipcRenderer.removeListener('onboarding:progress'")
    expect(source).toContain('isOnboardingProgressEvent(value)')
    expect(source).toContain('return () =>')
    expect(source).not.toContain('suggestedLocations')
    expect(source).not.toContain('preview')
  })
})
