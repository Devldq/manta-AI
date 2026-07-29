import { describe, expect, it, vi } from 'vitest'
import { ToolRegistry } from './registry.js'
import { createOnDemandTools } from './on-demand-tools.js'

const parameters = {
  type: 'object',
  properties: {
    query: { type: 'string' },
  },
  required: ['query'],
  additionalProperties: false,
}

describe('on-demand tool bridge', () => {
  it('keeps deferred schemas out of the fixed tool map and requires search before invoke', async () => {
    const execute = vi.fn(async ({ query }: { query: string }) => `result:${query}`)
    const registry = new ToolRegistry()
    const deferred = {
      name: 'github_search_issues',
      description: 'Search GitHub issues',
      parameters,
      execute,
      mcpServer: 'github',
      searchHint: 'github issue search',
    }
    registry.register(deferred)

    const tools = createOnDemandTools({
      registry,
      deferredTools: [deferred],
      skills: [],
      loadSkill: () => null,
    })
    const [toolSearch, toolInvoke] = tools

    await expect(toolInvoke.execute({
      toolName: deferred.name,
      arguments: { query: 'bug' },
    })).resolves.toContain('尚未加载')

    const searchResult = await toolSearch.execute({ query: 'github issue' })
    expect(searchResult).toEqual([
      {
        name: deferred.name,
        description: deferred.description,
        parameters,
      },
    ])

    await expect(toolInvoke.execute({
      toolName: deferred.name,
      arguments: { query: 'bug' },
    })).resolves.toBe('result:bug')
    expect(execute).toHaveBeenCalledWith({ query: 'bug' })
  })

  it('loads complete skill content only after skill_search is called', async () => {
    const registry = new ToolRegistry()
    const [,, skillSearch] = createOnDemandTools({
      registry,
      deferredTools: [],
      skills: [{
        id: 'skill-review',
        name: 'Code Review',
        description: 'Review code changes',
      }],
      loadSkill: id => ({
        id,
        name: 'Code Review',
        description: 'Review code changes',
        content: '# Review instructions\nInspect the diff.',
      }),
    })

    await expect(skillSearch.execute({ query: 'review code' })).resolves.toEqual([
      {
        id: 'skill-review',
        name: 'Code Review',
        description: 'Review code changes',
        content: '# Review instructions\nInspect the diff.',
      },
    ])
  })

  it('discovers MCP tools connected after the fixed conversation snapshot', async () => {
    const registry = new ToolRegistry()
    const lateTool = {
      name: 'github_create_issue',
      description: 'Create a GitHub issue',
      parameters,
      execute: async () => 'created',
      mcpServer: 'github',
    }
    let available: typeof lateTool[] = []
    const [toolSearch, toolInvoke] = createOnDemandTools({
      registry,
      deferredTools: [],
      resolveDeferredTools: () => available,
      skills: [],
      loadSkill: () => null,
    })

    registry.register(lateTool)
    available = [lateTool]

    await expect(toolSearch.execute({ query: 'github issue' })).resolves.toEqual([
      {
        name: lateTool.name,
        description: lateTool.description,
        parameters,
      },
    ])
    await expect(toolInvoke.execute({
      toolName: lateTool.name,
      arguments: { query: 'bug' },
    })).resolves.toBe('created')
  })
})
