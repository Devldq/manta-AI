import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('onboarding preload contract', () => {
  it('exposes only the durable initialization state query', async () => {
    const source = await readFile(resolve(__dirname, 'onboarding-preload.ts'), 'utf8')
    expect(source).toContain('state: () => ipcRenderer.invoke(\'onboarding:state\')')
  })
})
