import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { WorkspaceTerminalService } from './workspace-terminal.service'

async function waitFor(predicate: () => boolean, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for terminal output')
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

describe('WorkspaceTerminalService', () => {
  it('creates multiple system shell sessions and keeps their output isolated', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'manta-terminal-'))
    const service = new WorkspaceTerminalService()
    try {
      const input = { workspaceId: 'workspace-a', conversationId: 'conversation-a', cwd }
      const first = service.create(input)
      const second = service.create(input)
      service.create({ ...input, conversationId: 'conversation-b' })

      expect(first).toMatchObject({ name: '终端 1', provider: 'system-shell', status: 'running' })
      expect(second).toMatchObject({ name: '终端 2', provider: 'system-shell', status: 'running' })
      expect(service.list('workspace-a', 'conversation-a').map((session) => session.id)).toEqual([first.id, second.id])

      service.write(second.id, "printf '__MANTA_TERMINAL_TWO__\\n'\r")
      await waitFor(() => service.events(second.id).some(
        (event) => event.type === 'output' && event.data.includes('__MANTA_TERMINAL_TWO__'),
      ))
      expect(service.events(first.id).some((event) => event.data.includes('__MANTA_TERMINAL_TWO__'))).toBe(false)
      expect(service.resize(second.id, 132, 42)).toMatchObject({ cols: 132, rows: 42 })

      service.close(first.id)
      expect(service.list('workspace-a', 'conversation-a').map((session) => session.id)).toEqual([second.id])
    } finally {
      service.closeAll()
    }
  })
})
