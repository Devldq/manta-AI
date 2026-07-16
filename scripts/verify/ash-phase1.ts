#!/usr/bin/env node
const { spawnSync } = require('node:child_process')

const checks = [
  { criteria: [['1', 'new installation cannot bypass required initialization'], ['2', 'all seven groups resolve under manta-ai-data'], ['5', 'volume relocation retains a backup and applies future writes at the target'], ['6', 'a group can move to a separate volume'], ['7', 'copy/validation failures do not switch the mapping'], ['8', 'crash recovery restores a safe mapping'], ['9', 'backup paths retain the original data']], command: ['pnpm', '--filter', '@manta/storage-hub', 'test', '--', 'storage-foundation.acceptance'] },
  { criteria: [['1', 'desktop lifecycle gates the backend until onboarding succeeds'], ['2', 'backend reports every routed group'], ['4', 'storage UI endpoint returns volume/group inventory'], ['5', 'actual backend restarts against the relocated volume'], ['6', 'actual backend accepts a group migration'], ['10', 'subsequent backend writes resolve through the new mapping']], command: ['pnpm', '--filter', '@manta/desktop', 'test:e2e:ash'] },
  { criteria: [['3', 'browser durable state is migrated into ASH and RAG staging is retried safely']], command: ['pnpm', '--filter', '@manta/frontend', 'test'] },
  { criteria: [['8', 'new-process health failures restore the previous snapshot'], ['10', 'relaunch operations become successful only after health verification']], command: ['pnpm', '--filter', '@manta/desktop', 'test'] },
  { criteria: [['11', 'user and Agent-selected outputs remain outside ASH routing'], ['12', 'Windows and macOS persistence paths are statically audited']], command: ['pnpm', 'storage:audit'] },
]

for (const { criteria, command } of checks) {
  for (const [id, title] of criteria) process.stdout.write(`ASH Phase 1 criterion ${id}: ${title}\n`)
  const result = spawnSync(command[0], command.slice(1), { stdio: 'inherit', shell: process.platform === 'win32' })
  if (result.status !== 0) {
    process.stderr.write(`ASH Phase 1 acceptance evidence failed.\n`)
    process.exit(result.status ?? 1)
  }
}

process.stdout.write('ASH Phase 1 acceptance passed: criteria 1-12 are covered by the storage acceptance, desktop lifecycle E2E, migration fault matrix, browser/RAG migration tests, and the static persistence audit.\n')
