import { renderToStaticMarkup } from 'react-dom/server'
import ReactMarkdown from 'react-markdown'
import { describe, expect, it } from 'vitest'
import { AgentStepView } from './components/AgentStepView'
import { extractStepGroups, getTextContent, storedMessageToUIMessage } from './utils/formatters'
import { createMarkdownComponents } from './utils/markdown'
import type { StepGroup } from './utils/types'
import type { AgentPublicEvent } from '@manta/contracts'
import { getAgentRunSnapshot, isAgentRunTerminal } from './runtime/agent-run-view'

describe('streaming message rendering', () => {
  it('marks local Markdown links for the file preview interaction', () => {
    const html = renderToStaticMarkup(
      <ReactMarkdown components={createMarkdownComponents({ onOpenFile: () => undefined })}>
        {'[README](./README.md) and [Docs](https://example.com)'}
      </ReactMarkdown>,
    )

    expect(html).toContain('class="markdown-file-link"')
    expect(html).toContain('class="markdown-external-link"')
    expect(html).toContain('target="_blank"')
  })

  it('routes Mermaid fences to the chart renderer instead of a code block', () => {
    const html = renderToStaticMarkup(
      <ReactMarkdown components={createMarkdownComponents()}>
        {'```mermaid\ngraph TD\n  A --> B\n```'}
      </ReactMarkdown>,
    )

    expect(html).toContain('mermaid-loading')
    expect(html).not.toContain('language-mermaid')
  })

  it('shows concise tool events while keeping each input and output folded', () => {
    const groups: StepGroup[] = [{
      stepIndex: 0,
      purposeText: '',
      toolCalls: [{
        toolCallId: 'read-1',
        toolName: 'readFile',
        state: 'output-available',
        input: { file_path: 'src/app.ts' },
        output: 'source',
      }],
      isComplete: true,
      isActive: false,
    }]
    const html = renderToStaticMarkup(<AgentStepView groups={groups} isStreaming={false} />)

    expect(html).toContain('已处理 · 1 个操作')
    expect(html).toContain('已读取 src/app.ts')
    expect(html).toContain('aria-expanded="false"')
    expect(html).not.toContain('source')
  })

  it('keeps public progress with its tool step and leaves only the final answer in the message body', () => {
    const message = {
      id: 'assistant-1',
      role: 'assistant' as const,
      parts: [
        { type: 'step-start' as const },
        { type: 'text' as const, text: '配置入口已定位，接下来检查保存接口。' },
        {
          type: 'dynamic-tool' as const,
          toolCallId: 'read-1',
          toolName: 'readFile',
          state: 'output-available' as const,
          input: { file_path: 'src/settings.ts' },
          output: 'source',
        },
        { type: 'step-start' as const },
        { type: 'text' as const, text: '保存链路已经修复。' },
      ],
    }

    const groups = extractStepGroups(message.parts)
    expect(groups).toHaveLength(1)
    expect(groups[0].thinking).toBe('配置入口已定位，接下来检查保存接口。')
    expect(groups[0].toolCalls[0].toolName).toBe('readFile')
    expect(getTextContent(message)).toBe('保存链路已经修复。')
  })

  it('restores persisted progress and tool order after refresh', () => {
    const message = storedMessageToUIMessage({
      id: 'assistant-2',
      role: 'assistant',
      content: '检查完成。',
      timestamp: '2026-07-22T09:00:00.000Z',
      toolCalls: [{
        toolCallId: 'grep-1',
        toolName: 'grep',
        input: { pattern: 'save' },
        output: 'match',
        isError: false,
      }],
      stepUsages: [
        { inputTokens: 10, outputTokens: 5, toolNames: ['grep'], progressText: '先定位保存逻辑。' },
        { inputTokens: 12, outputTokens: 4 },
      ],
    })

    expect(message.parts.map((part) => part.type)).toEqual([
      'step-start',
      'text',
      'dynamic-tool',
      'step-start',
      'text',
    ])
    expect(extractStepGroups(message.parts)[0].thinking).toBe('先定位保存逻辑。')
    expect(getTextContent(message)).toBe('检查完成。')
  })

  it('uses backend public events as the authoritative run state', () => {
    const base = {
      schemaVersion: 1 as const,
      runId: 'run-1',
      conversationId: 'conversation-1',
      messageId: 'assistant-1',
      timestamp: '2026-07-22T10:00:00.000Z',
      data: {},
    }
    const events: AgentPublicEvent[] = [
      { ...base, seq: 8, phase: 'completed', type: 'run.completed' },
      { ...base, seq: 2, phase: 'executing', type: 'run.started' },
      { ...base, seq: 6, phase: 'cancelling', type: 'run.cancellation_requested' },
    ]
    const parts = events.map(event => ({ type: 'data-agent-run', data: event })) as never
    const snapshot = getAgentRunSnapshot(parts)

    expect(snapshot?.lastSeq).toBe(8)
    expect(snapshot?.status).toBe('completed')
    expect(isAgentRunTerminal(snapshot)).toBe(true)
  })
})
