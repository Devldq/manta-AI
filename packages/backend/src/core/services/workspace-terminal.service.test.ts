import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { WorkspaceTerminalService } from './workspace-terminal.service'

async function waitFor(predicate: () => boolean, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for terminal output')
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

describe('WorkspaceTerminalService', () => {
  it('keeps one shell per workspace conversation and replays output', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'manta-terminal-'))
    const service = new WorkspaceTerminalService()
    try {
      const first = service.createOrGet({ workspaceId: 'workspace-a', conversationId: 'conversation-a', cwd })
      const same = service.createOrGet({ workspaceId: 'workspace-a', conversationId: 'conversation-a', cwd })
      expect(same.id).toBe(first.id)

      service.write(first.id, "printf '__MANTA_TERMINAL_OK__\\n'")
      await waitFor(() => service.events(first.id).some(
        (event) => event.type === 'output' && event.data.includes('__MANTA_TERMINAL_OK__'),
      ))

      expect(service.events(first.id).some((event) => event.type === 'input')).toBe(true)
      expect(service.events(first.id).some((event) => event.type === 'output')).toBe(true)
      expect(service.current('workspace-a', 'conversation-a')?.status).toBe('running')
    } finally {
      service.closeAll()
    }
  })
})
