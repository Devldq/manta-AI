#!/usr/bin/env node
const { spawnSync } = require('node:child_process')
const { readFileSync } = require('node:fs')
const { literalMcpCredentialGuard } = require('./ash-phase4-guard.ts')

const agentSurface = [
  'packages/backend/src/storage/agent-storage.ts',
  'packages/backend/src/storage/runtime.ts',
  'packages/backend/src/routes/storage.ts',
  'packages/desktop/src/desktop-runtime.ts',
  'packages/desktop/src/ipc/registerStorageIpc.ts',
  'packages/desktop/src/preload/main-preload.ts',
  'packages/frontend/src/features/storage/desktop-storage-bridge.ts',
  'packages/frontend/src/features/storage/storage-api.ts',
  'packages/frontend/src/features/storage/AgentConnectionsSection.tsx',
  'packages/shared/src/storage.ts',
]
const source = agentSurface.map((path) => readFileSync(path, 'utf8')).join('\n')
for (const forbidden of [/Agent Harness/i, /child_process/, /\bspawn(?:Sync)?\s*\(/, /\bexec(?:File|Sync)?\s*\(/, /model[- ]loop/i, /arbitrary filesystem/i]) {
  if (forbidden.test(source)) { process.stderr.write(`Forbidden Agent surface capability: ${forbidden}\n`); process.exit(1) }
}
const rendererSurface = ['packages/desktop/src/preload/main-preload.ts', 'packages/frontend/src/features/storage/desktop-storage-bridge.ts', 'packages/frontend/src/features/storage/storage-api.ts', 'packages/frontend/src/features/storage/AgentConnectionsSection.tsx', 'packages/shared/src/storage.ts'].map((path) => readFileSync(path, 'utf8')).join('\n')
for (const forbidden of [/\b(?:secret|credential|token)(?:Value|Literal)\b/i, /node:(?:fs|child_process)/]) {
  if (forbidden.test(rendererSurface)) { process.stderr.write(`Forbidden raw secret or filesystem capability in renderer Agent surface: ${forbidden}\n`); process.exit(1) }
}
const backendAgentSource = readFileSync('packages/backend/src/storage/agent-storage.ts', 'utf8')
const backendProjectionDtoSurface = `${backendAgentSource.match(/export interface AgentPlanPreview[\s\S]*?interface PlanSession/)?.[0] ?? ''}\n${backendAgentSource.match(/function publicOperations[^\n]*/)?.[0] ?? ''}`
const projectionDtoSurface = `${backendProjectionDtoSurface}\n${['packages/desktop/src/ipc/registerStorageIpc.ts', 'packages/desktop/src/preload/main-preload.ts', 'packages/frontend/src/features/storage/desktop-storage-bridge.ts', 'packages/frontend/src/features/storage/storage-api.ts', 'packages/shared/src/storage.ts'].map((path) => readFileSync(path, 'utf8')).join('\n')}`
if (literalMcpCredentialGuard.test(projectionDtoSurface)) { process.stderr.write('Forbidden literal MCP credential field or credential-bearing URL in Agent projection DTO surface\n'); process.exit(1) }

const checks = [
  { title: 'shared Agent contracts and projection DTO credential guard', command: ['pnpm', '--filter', '@manta/shared', 'exec', 'vitest', 'run', 'src/storage-agents.test.ts', 'src/ash-phase4-guard.test.ts'] },
  { title: 'trusted Codex adapter and durable coordinator regression', command: ['pnpm', '--filter', '@manta/storage-hub', 'exec', 'vitest', 'run', 'src/adapters/codex/codex-adapter.test.ts', 'src/adapters/projection-coordinator.test.ts'] },
  { title: 'Backend CAS repositories, service, composition, and read routes', command: ['pnpm', '--filter', '@manta/backend', 'exec', 'vitest', 'run', 'src/storage/agent-storage.test.ts', 'src/storage/runtime.test.ts', 'src/routes/storage.test.ts'] },
  { title: 'privileged Desktop IPC', command: ['pnpm', '--filter', '@manta/desktop', 'exec', 'vitest', 'run', 'src/ipc/registerStorageIpc.test.ts', 'src/preload/main-preload.test.ts'] },
  { title: 'Storage Agent API, bridge, and accessible UI', command: ['pnpm', '--filter', '@manta/frontend', 'exec', 'vitest', 'run', 'src/features/storage/storage-api.test.ts', 'src/features/storage/desktop-storage-bridge.test.ts', 'src/features/storage/AgentConnectionsSection.test.tsx', 'src/features/storage/StorageSettingsPanel.test.tsx'] },
]
for (const { title, command } of checks) {
  process.stdout.write(`ASH Phase 4 criterion: ${title}\n`)
  const result = spawnSync(command[0], command.slice(1), { stdio: 'inherit', shell: process.platform === 'win32' })
  if (result.status !== 0) process.exit(result.status ?? 1)
}
process.stdout.write('ASH Phase 4 acceptance passed: Agent connection is read-only over HTTP, privileged over sender-bound IPC, CAS-backed, recoverable, and secret-safe.\n')
