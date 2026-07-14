import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { createStorageHub } from './storage-hub'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })

it('measures every volume with the mandatory pending runtime composition', async () => {
  const parents = await Promise.all(['one', 'two'].map(async (name) => { const path = await mkdtemp(join(tmpdir(), `ash-cap-${name}-`)); roots.push(path); return path }))
  const inspected: string[] = []
  const hub = await createStorageHub({
    bootstrap: { schemaVersion: 1, generation: 1, volumes: parents.map((parentPath, index) => ({ id: `v${index + 1}`, name: `V${index + 1}`, parentPath, createdAt: '2026-07-14T00:00:00.000Z', updatedAt: '2026-07-14T00:00:00.000Z' })), groupAssignments: { extensions: 'v1', knowledge: 'v1', work: 'v1', config: 'v1', secrets: 'v2', diagnostics: 'v2', cache: 'v2' } },
    capacityPending: async (volumeId) => { inspected.push(volumeId); return { complete: true } },
    capacityAllocation: () => ({ allocatedBytes: 0, evidence: 'verified-test' }),
  })
  const result = await hub.capacityMetrics()
  expect(inspected.sort()).toEqual(['v1', 'v2']); expect(result.volumes.map((item) => item.volumeId)).toEqual(['v1', 'v2']); expect(result.aggregate.scanStatus).toBe('complete')
})
