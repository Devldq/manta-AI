import { beforeEach, describe, expect, it, vi } from 'vitest'

const connectGate = vi.hoisted(() => {
  let release!: () => void
  return {
    wait: new Promise<void>((resolve) => { release = resolve }),
    release: () => release(),
  }
})

vi.mock('./config.js', () => ({
  getEffectiveServers: () => [{
    name: 'slow-server',
    enabled: true,
    config: { type: 'local', command: ['slow-server'] },
  }],
  getMCPToolVisibility: () => null,
}))

vi.mock('./client.js', () => ({
  MCPClient: class {
    async connect() { await connectGate.wait }
    async listTools() { return [] }
    async close() {}
  },
  MockMCPClient: class {},
  RemoteMCPClient: class {},
}))

vi.mock('@tools/index', () => ({
  createAllTools: () => [],
}))

vi.mock('../registry/tool-search.js', () => ({
  createToolSearchTool: () => ({
    name: 'tool_search',
    description: 'Search tools',
    parameters: { type: 'object', properties: {} },
    execute: async () => [],
  }),
}))

describe('MCP tool registry startup', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('returns builtin tools without awaiting cold MCP discovery', async () => {
    const { getToolRegistry } = await import('./setup.js')
    const outcome = await Promise.race([
      getToolRegistry().then(() => 'ready'),
      new Promise<string>((resolve) => setTimeout(() => resolve('blocked'), 50)),
    ])

    expect(outcome).toBe('ready')
    connectGate.release()
  })
})
