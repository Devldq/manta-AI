import { describe, expect, it } from 'vitest'
import { ToolRegistry } from './registry/registry.js'

const parameters = { type: 'object', properties: {} }
const execute = async () => 'ok'

describe('per-agent tool visibility', () => {
  it('uses the same filtered tool set for execution and the prompt summary', () => {
    const registry = new ToolRegistry()
    registry.register(
      { name: 'read', description: 'Read files', parameters, execute },
      { name: 'github_issues', description: 'GitHub issues', parameters, execute, mcpServer: 'github' },
      { name: 'figma_files', description: 'Figma files', parameters, execute, mcpServer: 'figma' },
    )

    const visibleTools = registry.getByAgent('reviewer', {
      tools: { '*': false },
      agent: {
        reviewer: {
          tools: { 'github_*': true },
        },
      },
    })
    const summary = registry.getDeferredToolSummary(visibleTools)
    const executableTools = registry.toAISDKFormatForAgent('reviewer', {
      tools: { '*': false },
      agent: {
        reviewer: {
          tools: { 'github_*': true },
        },
      },
    })

    expect(visibleTools.map(tool => tool.name)).toEqual(['read', 'github_issues'])
    expect(Object.keys(executableTools)).toEqual(['read', 'github_issues'])
    expect(summary).toContain('github_issues')
    expect(summary).not.toContain('figma_files')
  })
})
