import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import * as fs from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { runWithStorageResolver } from '../../../storage/path-routing'
import {
  appendMessage,
  createConversation,
  deleteConversation,
  listConversationSummaries,
} from './store'
import {
  appendWorkspaceMessage,
  createWorkspace,
  createWorkspaceConversation,
  deleteWorkspaceConversation,
  listWorkspaceConversationSummaries,
} from '../workspace/store'

function fixture<T>(operation: (root: string) => T): T {
  const root = mkdtempSync(join(tmpdir(), 'manta-conversation-summary-'))
  return runWithStorageResolver(
    {
      resolve: (group, ...segments) => join(root, group, ...segments),
      resolveLocalCache: (...segments) => join(root, 'machine-cache', ...segments),
    },
    () => operation(root),
  )
}

describe('conversation summary indexes', () => {
  it('serves the global list from the local summary index without parsing cloud session history', () => fixture(async (root) => {
    const conv = createConversation('main')
    appendMessage(conv.id, 'user', '索引中的标题')

    expect(await listConversationSummaries()).toEqual([
      expect.objectContaining({ id: conv.id, title: '索引中的标题', messageCount: 1 }),
    ])

    const sessionPath = join(root, 'work', 'conversations', conv.id, 'session.json')
    writeFileSync(sessionPath, '{ unreadable history')
    expect(await listConversationSummaries()).toEqual([
      expect.objectContaining({ id: conv.id, title: '索引中的标题', messageCount: 1 }),
    ])
    expect(readFileSync(join(root, 'machine-cache', 'conversation-indexes', 'global.json'), 'utf8'))
      .not.toContain('索引中的标题"}]')

    expect(deleteConversation(conv.id)).toBe(true)
    expect(await listConversationSummaries()).toEqual([])
  }))

  it('repairs a workspace index once, then serves summaries without parsing session history', () => fixture(async (root) => {
    const workspace = createWorkspace({ name: '索引项目' })
    const conv = createWorkspaceConversation(workspace.id, 'main')
    expect(conv).not.toBeNull()
    appendWorkspaceMessage(workspace.id, conv!.id, 'user', '项目会话标题')

    const indexPath = join(root, 'machine-cache', 'conversation-indexes', 'workspaces', `${workspace.id}.json`)
    writeFileSync(indexPath, '{ corrupt index')
    expect(await listWorkspaceConversationSummaries(workspace.id)).toEqual([
      expect.objectContaining({ id: conv!.id, title: '项目会话标题', messageCount: 1 }),
    ])

    const sessionPath = join(root, 'work', 'workspaces', workspace.id, 'conversations', conv!.id, 'session.json')
    writeFileSync(sessionPath, '{ unreadable history')
    expect(await listWorkspaceConversationSummaries(workspace.id)).toEqual([
      expect.objectContaining({ id: conv!.id, title: '项目会话标题', messageCount: 1 }),
    ])

    expect(deleteWorkspaceConversation(workspace.id, conv!.id)).toBe(true)
    expect(await listWorkspaceConversationSummaries(workspace.id)).toEqual([])
  }))

  it('rebuilds a missing global index from an existing session', () => fixture(async (root) => {
    const id = 'legacy-session'
    const directory = join(root, 'work', 'conversations', id)
    mkdirSync(directory, { recursive: true })
    writeFileSync(join(directory, 'session.json'), JSON.stringify({
      id,
      title: '已有会话',
      agentName: 'main',
      messages: [{ id: 'message', role: 'user', content: 'hello', timestamp: '2026-01-01T00:00:00.000Z' }],
      context: {},
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    }))

    expect(await listConversationSummaries()).toEqual([
      expect.objectContaining({ id, title: '已有会话', messageCount: 1 }),
    ])
  }))

  it('does not serialize independent workspace cache misses behind one slow cloud read', () => fixture(async (root) => {
    const slowWorkspace = createWorkspace({ name: '慢项目' })
    const fastWorkspace = createWorkspace({ name: '快项目' })
    createWorkspaceConversation(slowWorkspace.id, 'main')
    createWorkspaceConversation(fastWorkspace.id, 'main')
    rmSync(join(root, 'machine-cache', 'conversation-indexes', 'workspaces'), { recursive: true, force: true })

    const originalReadFile = fs.promises.readFile.bind(fs.promises)
    const slowIndex = join(root, 'work', 'workspaces', slowWorkspace.id, 'conversations', '.conversation-index.json')
    const readSpy = vi.spyOn(fs.promises, 'readFile').mockImplementation(async (...args) => {
      if (String(args[0]) === slowIndex) await new Promise((resolve) => setTimeout(resolve, 100))
      return originalReadFile(...args as Parameters<typeof originalReadFile>)
    })

    try {
      const completionOrder: string[] = []
      const slow = listWorkspaceConversationSummaries(slowWorkspace.id).then(() => completionOrder.push('slow'))
      const fast = listWorkspaceConversationSummaries(fastWorkspace.id).then(() => completionOrder.push('fast'))
      await Promise.all([slow, fast])
      expect(completionOrder).toEqual(['fast', 'slow'])
    } finally {
      readSpy.mockRestore()
    }
  }))
})
