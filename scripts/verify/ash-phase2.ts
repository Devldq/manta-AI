#!/usr/bin/env node
const { spawnSync } = require('node:child_process')

const checks = [
  { title: 'cloud-folder polling detects offline, unreadable, and conflict-copy states', command: ['pnpm', '--filter', '@manta/storage-hub', 'exec', 'vitest', 'run', 'src/volumes/folder-health.test.ts'] },
  { title: 'manual, startup, and interval synchronization serialize per volume', command: ['pnpm', '--filter', '@manta/storage-hub', 'exec', 'vitest', 'run', 'src/sync/scheduler.test.ts'] },
  { title: 'Git snapshots and imports remain cache-isolated around cloud volumes', command: ['pnpm', '--filter', '@manta/storage-hub', 'exec', 'vitest', 'run', 'src/sync/git/git-runner.test.ts'] },
  { title: 'desktop lifecycle joins health polling and scheduling safely', command: ['pnpm', '--filter', '@manta/desktop', 'exec', 'vitest', 'run', 'src/lifecycle/createCloudSyncRuntime.test.ts'] },
  { title: 'health status is exposed without unsafe persistence paths', command: ['pnpm', 'storage:audit'] },
]

for (const { title, command } of checks) {
  process.stdout.write(`ASH Phase 2 criterion: ${title}\n`)
  const result = spawnSync(command[0], command.slice(1), { stdio: 'inherit', shell: process.platform === 'win32' })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

process.stdout.write('ASH Phase 2 acceptance passed: cloud-folder health, conflict reporting, cache-isolated Git sync, and serialized scheduling are covered.\n')
