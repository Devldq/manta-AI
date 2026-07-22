import type { UIMessage } from 'ai'
import { describe, expect, it } from 'vitest'
import { mergeStreamingParts } from './useReconnectSSE'

describe('reconnected agent stream parts', () => {
  it('does not merge a final answer into progress text from an earlier step', () => {
    const existing: UIMessage['parts'] = [
      { type: 'step-start' },
      { type: 'text', text: '先检查配置。' },
      {
        type: 'dynamic-tool',
        toolCallId: 'read-1',
        toolName: 'readFile',
        state: 'output-available',
        input: { file_path: 'config.ts' },
        output: 'source',
      },
      { type: 'step-start' },
    ]

    const withFinalStart = mergeStreamingParts(existing, { type: 'text', text: '修复完成' })
    const result = mergeStreamingParts(withFinalStart, { type: 'text', text: '。' })

    expect(result.filter((part) => part.type === 'text')).toEqual([
      { type: 'text', text: '先检查配置。' },
      { type: 'text', text: '修复完成。' },
    ])
  })

  it('keeps tool identity and input when a reconnected output arrives', () => {
    const existing: UIMessage['parts'] = [{
      type: 'dynamic-tool',
      toolCallId: 'read-1',
      toolName: 'readFile',
      state: 'input-available',
      input: { file_path: 'config.ts' },
    }]

    const result = mergeStreamingParts(existing, {
      type: 'dynamic-tool',
      toolCallId: 'read-1',
      toolName: '',
      state: 'output-available',
      input: undefined,
      output: 'source',
    })

    expect(result[0]).toEqual(expect.objectContaining({
      toolName: 'readFile',
      input: { file_path: 'config.ts' },
      output: 'source',
    }))
  })
})
