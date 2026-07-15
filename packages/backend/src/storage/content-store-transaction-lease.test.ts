import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { withVolumeContentStoreLease } from '@manta/storage-hub'
import { transactionalWriteExtensionFile } from './extension-transactions'
import { transactCrossGroupBundle } from './cross-group-bundle'

const roots: string[] = []
async function volume(): Promise<string> { const root = await mkdtemp(join(tmpdir(), 'ash-transaction-lease-')); roots.push(root); return root }
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })

describe('pending transaction writers share the content-store lease', () => {
  it('fails extension journal creation closed while GC owns the volume lease', async () => {
    const root = await volume(); const extensionsRoot = join(root, 'extensions'); await mkdir(extensionsRoot)
    await withVolumeContentStoreLease(root, async () => {
      expect(() => transactionalWriteExtensionFile({ extensionsRoot, destination: join(extensionsRoot, 'package.json'), content: '{}' })).toThrow(/content-store|busy|lease/i)
    })
  })

  it('fails cross-group prepare closed while GC owns the volume lease', async () => {
    const root = await volume(); const first = join(root, 'config'); const second = join(root, 'work'); await mkdir(first); await mkdir(second)
    await withVolumeContentStoreLease(root, async () => {
      expect(() => transactCrossGroupBundle([{ name: 'config', root: first }, { name: 'work', root: second }], 'bundle', (tx) => tx.write('config', 'value.json', '{}'))).toThrow(/content-store|busy|lease/i)
    })
  })
})
