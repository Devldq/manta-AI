import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('onboarding preload contract', () => {
  it('exposes only the four required onboarding actions', async () => {
    const source = await readFile(resolve(__dirname, 'onboarding-preload.ts'), 'utf8')
    expect(source.match(/ipcRenderer\.invoke\(/g)).toHaveLength(4)
    expect(source).toContain("state: () => ipcRenderer.invoke('onboarding:state')")
    expect(source).toContain("selectParent: () => ipcRenderer.invoke('onboarding:select-parent')")
    expect(source).toContain("initialize: (selectionId: string) => ipcRenderer.invoke('onboarding:initialize', { selectionId })")
    expect(source).toContain("quit: () => ipcRenderer.invoke('onboarding:quit')")
    expect(source).not.toContain('suggestedLocations')
    expect(source).not.toContain('preview')
  })
})
