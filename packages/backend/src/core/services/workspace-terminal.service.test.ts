import { describe, expect, it } from 'vitest'
import {
  WorkspaceTerminalService,
  type WorkspaceTerminalController,
} from './workspace-terminal.service'

class FakeIterm2Controller implements WorkspaceTerminalController {
  readonly sessions = new Map<string, { id: string; name: string; tty: string; scopeKey: string; cwd: string }>()
  readonly writes: Array<{ id: string; command: string }> = []
  focusedId = ''
  nextId = 1

  async available() {
    return true
  }

  async list(scopeKey: string) {
    return [...this.sessions.values()].filter((session) => session.scopeKey === scopeKey)
  }

  async create(input: { scopeKey: string; cwd: string; name: string }) {
    const id = `iterm-session-${this.nextId}`
    const session = { id, tty: `/dev/ttys0${this.nextId}`, ...input }
    this.nextId += 1
    this.sessions.set(id, session)
    return session
  }

  async write(id: string, command: string) {
    this.writes.push({ id, command })
  }

  async focus(id: string) {
    this.focusedId = id
  }

  async close(id: string) {
    this.sessions.delete(id)
  }
}

describe('WorkspaceTerminalService', () => {
  it('creates multiple iTerm2 sessions and recovers them by conversation scope', async () => {
    const controller = new FakeIterm2Controller()
    const service = new WorkspaceTerminalService(controller)
    const input = { workspaceId: 'workspace-a', conversationId: 'conversation-a', cwd: '/tmp/project' }

    const first = await service.create(input)
    const second = await service.create(input)
    await service.create({ ...input, conversationId: 'conversation-b' })

    expect(first).toMatchObject({ name: '终端 1', provider: 'iterm2', status: 'running' })
    expect(second).toMatchObject({ name: '终端 2', provider: 'iterm2', status: 'running' })
    await expect(service.list(input)).resolves.toEqual([first, second])

    await service.write(second.id, 'printf ok\n')
    await service.focus(second.id)
    expect(controller.writes).toEqual([{ id: second.id, command: 'printf ok' }])
    expect(controller.focusedId).toBe(second.id)

    await service.close(first.id)
    await expect(service.list(input)).resolves.toEqual([second])
  })

  it('fails clearly when iTerm2 is unavailable', async () => {
    const controller = new FakeIterm2Controller()
    controller.available = async () => false
    const service = new WorkspaceTerminalService(controller)

    await expect(service.create({
      workspaceId: 'workspace-a',
      conversationId: 'conversation-a',
      cwd: '/tmp/project',
    })).rejects.toMatchObject({ message: expect.stringContaining('iTerm2'), statusCode: 503 })
  })
})
