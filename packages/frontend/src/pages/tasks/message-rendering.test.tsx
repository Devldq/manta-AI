import { renderToStaticMarkup } from 'react-dom/server'
import ReactMarkdown from 'react-markdown'
import { describe, expect, it } from 'vitest'
import { AgentStepView } from './components/AgentStepView'
import { MessageRow } from './components/MessageRow'
import { mergeAgentRunProgress } from './components/ToolCallLog'
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

  it('collapses completed execution details into a concise summary', () => {
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
    expect(html).toContain('aria-expanded="false"')
    expect(html).not.toContain('已读取 src/app.ts')
    expect(html).not.toContain('source')
  })

  it('separates a completed tool run from its task summary', () => {
    const html = renderToStaticMarkup(
      <MessageRow
        agentName="default"
        isStreaming={false}
        message={{
          id: 'assistant-summary',
          role: 'assistant',
          parts: [
            {
              type: 'dynamic-tool',
              toolCallId: 'read-1',
              toolName: 'readFile',
              state: 'output-available',
              input: { file_path: 'src/app.ts' },
              output: 'source',
            } as never,
            { type: 'text', text: '已完成检查。' },
          ],
        }}
      />,
    )

    expect(html).toContain('aria-label="任务总结"')
    expect(html).toContain('任务总结')
    expect(html).toContain('已完成检查。')
    expect(html).toContain('aria-expanded="false"')
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

  it('keeps backend progress when live tool parts do not contain provider text', () => {
    const groups: StepGroup[] = [{
      stepIndex: 0,
      purposeText: '',
      toolCalls: [{
        toolCallId: 'read-1',
        toolName: 'read',
        state: 'output-available',
        input: { file_path: 'package.json' },
        output: 'source',
      }],
      isComplete: true,
      isActive: false,
    }]

    const merged = mergeAgentRunProgress(groups, {
      schemaVersion: 1,
      runId: 'run-1',
      conversationId: 'conversation-1',
      messageId: 'assistant-1',
      status: 'completed',
      phase: 'completed',
      lastSeq: 10,
      steps: [{
        stepIndex: 0,
        status: 'completed',
        startedAt: '2026-07-23T03:17:40.493Z',
        progressText: '正在读取相关信息，确认当前实现。',
        tools: [],
      }],
    })

    expect(merged[0].thinking).toBe('正在读取相关信息，确认当前实现。')
    expect(merged[0].purposeText).toBe('正在读取相关信息，确认当前实现。')
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
