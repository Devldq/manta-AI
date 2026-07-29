import { describe, expect, it } from 'vitest'
import { createAgentRunContextSnapshot } from './agent-run-context.js'

describe('Agent Run context snapshot', () => {
  it('freezes the system prompt and tool map for the lifetime of a run', () => {
    const sourceTools = {
      read: { description: 'Read files' },
    }
    const snapshot = createAgentRunContextSnapshot('fixed system prompt', sourceTools)

    sourceTools.read = { description: 'Changed after snapshot' }
    Object.assign(sourceTools, {
      github_issue: { description: 'Connected after snapshot' },
    })

    expect(snapshot.systemPrompt).toBe('fixed system prompt')
    expect(Object.keys(snapshot.tools)).toEqual(['read'])
    expect(snapshot.tools.read).toEqual({ description: 'Read files' })
    expect(Object.isFrozen(snapshot)).toBe(true)
    expect(Object.isFrozen(snapshot.tools)).toBe(true)
  })
})
