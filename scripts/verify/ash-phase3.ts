#!/usr/bin/env node
const { spawnSync } = require('node:child_process')

const checks = [
  { title: 'shared capacity contracts build before downstream packages', command: ['pnpm', '--filter', '@manta/shared', 'build'] },
  { title: 'shared capacity DTO and overflow contracts', command: ['pnpm', '--filter', '@manta/shared', 'exec', 'vitest', 'run', 'src/storage-capacity.test.ts'] },
  { title: 'Phase 3 verifier ordering contract', command: ['node', 'scripts/verify/ash-phase3.test.cjs'] },
  { title: 'volume-local CAS references, allocation, GC, and truthful capacity', command: ['pnpm', '--filter', '@manta/storage-hub', 'exec', 'vitest', 'run', 'src/content-store/content-store.test.ts', 'src/content-store/reference-scan.test.ts', 'src/content-store/garbage-collector.test.ts', 'src/content-store/capacity-metrics.test.ts', 'src/inventory/allocation.test.ts'] },
  { title: 'mandatory pending inspection and runtime capacity composition', command: ['pnpm', '--filter', '@manta/storage-hub', 'exec', 'vitest', 'run', 'src/runtime/capacity-metrics.test.ts', 'src/sync/git/git-pending.test.ts'] },
  { title: 'backend pending references and Storage API integration', command: ['pnpm', '--filter', '@manta/backend', 'exec', 'vitest', 'run', 'src/storage/content-references.test.ts', 'src/storage/runtime.test.ts', 'src/routes/storage.test.ts'] },
  { title: 'Storage API client and no-false-savings UI', command: ['pnpm', '--filter', '@manta/frontend', 'exec', 'vitest', 'run', 'src/features/storage/storage-api.test.ts', 'src/features/storage/StorageSettingsPanel.test.tsx'] },
  { title: 'workspace type safety', command: ['pnpm', 'typecheck'] },
  { title: 'storage boundary audit', command: ['pnpm', 'storage:audit'] },
]

for (const { title, command } of checks) {
  process.stdout.write(`ASH Phase 3 criterion: ${title}\n`)
  const result = spawnSync(command[0], command.slice(1), { stdio: 'inherit', shell: process.platform === 'win32' })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

process.stdout.write('ASH Phase 3 acceptance passed: verified capacity remains volume-local, read-only, pending-aware, API-typed, and truthfully presented.\n')
