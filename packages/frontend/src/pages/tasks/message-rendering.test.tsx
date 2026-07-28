import { renderToStaticMarkup } from 'react-dom/server'
import ReactMarkdown from 'react-markdown'
import { describe, expect, it } from 'vitest'
import { AgentStepView } from './components/AgentStepView'
import { MessageRow } from './components/MessageRow'
import { compactReadOnlyStepGroups, mergeAgentRunProgress } from './components/ToolCallLog'
import {
  describeToolBatch,
  extractStepGroups,
  getTextContent,
  storedMessageToUIMessage,
} from './utils/formatters'
import { createMarkdownComponents } from './utils/markdown'
import type { StepGroup } from './utils/types'
import type { AgentPublicEvent } from '@manta/contracts'
import { applyAgentPublicEvent, getAgentRunSnapshot, isAgentRunTerminal } from './runtime/agent-run-view'

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

  it('collapses completed execution details under the processed summary', () => {
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
    const html = renderToStaticMarkup(
      <AgentStepView
        groups={groups}
        isStreaming={false}
        agentRun={{
          schemaVersion: 1,
          runId: 'run-completed',
          conversationId: 'conversation-1',
          messageId: 'assistant-1',
          status: 'completed',
          phase: 'completed',
          lastSeq: 8,
          durationMs: 9_000,
          steps: [],
        }}
      />,
    )

    expect(html).toContain('已处理 9s')
    expect(html).not.toContain('个操作')
    expect(html).toContain('aria-expanded="false"')
    expect(html).not.toContain('已读取 src/app.ts')
    expect(html).not.toContain('source')
  })

  it('shows each public execution intent directly before its tool while running', () => {
    const groups: StepGroup[] = [{
      stepIndex: 0,
      purposeText: '正在定位相关文件和实现入口。',
      thinking: '正在定位相关文件和实现入口。',
      toolCalls: [{
        toolCallId: 'grep-1',
        toolName: 'grep',
        state: 'input-available',
        input: { pattern: 'AgentLoop' },
        output: undefined,
      }],
      isComplete: false,
      isActive: true,
    }]
    const html = renderToStaticMarkup(<AgentStepView groups={groups} isStreaming />)

    expect(html).toContain('正在定位相关文件和实现入口。')
    expect(html).toContain('AgentLoop')
    expect(html).not.toContain('过程消息')
  })

  it('keeps a multi-tool batch collapsed between the process summary and tool details', () => {
    const groups: StepGroup[] = [{
      stepIndex: 0,
      purposeText: '批量核对实现并运行测试。',
      thinking: '批量核对实现并运行测试。',
      toolCalls: [
        {
          toolCallId: 'read-1',
          toolName: 'readFile',
          state: 'output-available',
          input: { file_path: 'src/app.ts' },
          output: 'source',
        },
        {
          toolCallId: 'bash-1',
          toolName: 'bash',
          state: 'output-available',
          input: { command: 'pnpm test' },
          output: 'passed',
        },
      ],
      isComplete: true,
      isActive: false,
    }]

    const html = renderToStaticMarkup(<AgentStepView groups={groups} isStreaming />)

    expect(html).toContain('已读取 1 个文件并运行 1 个命令')
    expect(html).toContain('2 个工具调用')
    expect(html).not.toContain('src/app.ts')
    expect(html).not.toContain('pnpm test')
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

  it('does not render execution text as a live task summary', () => {
    const html = renderToStaticMarkup(
      <MessageRow
        agentName="default"
        isStreaming
        message={{
          id: 'assistant-running',
          role: 'assistant',
          parts: [
            { type: 'step-start' },
            { type: 'text', text: '入口在 packages/rag，接下来沿检索链路确认模块边界。' },
            {
              type: 'dynamic-tool',
              toolCallId: 'read-1',
              toolName: 'readFile',
              state: 'input-available',
              input: { file_path: 'packages/rag/src/index.ts' },
            } as never,
          ],
          metadata: {
            agentRun: {
              schemaVersion: 1,
              runId: 'run-executing',
              conversationId: 'conversation-1',
              messageId: 'assistant-running',
              status: 'running',
              phase: 'executing',
              lastSeq: 4,
              steps: [{
                stepIndex: 0,
                status: 'running',
                startedAt: '2026-07-23T04:00:00.000Z',
                progressText: '入口在 packages/rag，接下来沿检索链路确认模块边界。',
                tools: [],
              }],
            },
          },
        }}
      />,
    )

    expect(html).toContain('入口在 packages/rag，接下来沿检索链路确认模块边界。')
    expect(html).not.toContain('任务总结')
    expect(html).not.toContain('正在总结')
  })

  it('waits for completion before revealing the final summary text', () => {
    const html = renderToStaticMarkup(
      <MessageRow
        agentName="default"
        isStreaming
        message={{
          id: 'assistant-summarizing',
          role: 'assistant',
          parts: [
            { type: 'step-start' },
            { type: 'text', text: '这是尚未完成的流式总结片段。' },
          ],
          metadata: {
            agentRun: {
              schemaVersion: 1,
              runId: 'run-summarizing',
              conversationId: 'conversation-1',
              messageId: 'assistant-summarizing',
              status: 'running',
              phase: 'summarizing',
              lastSeq: 8,
              steps: [],
            },
          },
        }}
      />,
    )

    expect(html).not.toContain('这是尚未完成的流式总结片段。')
    expect(html).not.toContain('任务总结')
    expect(html).not.toContain('正在总结')
  })

  it('does not show an empty summary section for a cancelled run', () => {
    const html = renderToStaticMarkup(
      <MessageRow
        agentName="default"
        isStreaming={false}
        message={{
          id: 'assistant-cancelled',
          role: 'assistant',
          parts: [
            { type: 'step-start' },
            { type: 'text', text: '   ' },
          ],
          metadata: {
            agentRun: {
              schemaVersion: 1,
              runId: 'run-cancelled',
              conversationId: 'conversation-1',
              messageId: 'assistant-cancelled',
              status: 'cancelled',
              phase: 'cancelled',
              lastSeq: 9,
              steps: [],
            },
          },
        }}
      />,
    )

    expect(html).not.toContain('任务总结')
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

  it('prefers structured action rationales over generic provider narration', () => {
    const groups: StepGroup[] = [{
      stepIndex: 0,
      purposeText: '我来读取文件。',
      thinking: '我来读取文件。',
      toolCalls: [],
      isComplete: false,
      isActive: true,
    }]

    const merged = mergeAgentRunProgress(groups, {
      schemaVersion: 1,
      runId: 'run-rationale',
      conversationId: 'conversation-1',
      messageId: 'assistant-1',
      status: 'running',
      phase: 'executing',
      lastSeq: 4,
      steps: [{
        stepIndex: 0,
        status: 'running',
        startedAt: '2026-07-23T04:00:00.000Z',
        progressText: '根目录版本是 2.0.0；继续读取 backend 清单可以核对两者是否一致。',
        tools: [],
      }],
    })

    expect(merged[0].thinking).toBe('根目录版本是 2.0.0；继续读取 backend 清单可以核对两者是否一致。')
  })

  it('compacts adjacent read-only steps into one investigation batch', () => {
    const groups = compactReadOnlyStepGroups([
      {
        stepIndex: 0,
        purposeText: '先确认目录结构。',
        thinking: '先确认目录结构。',
        toolCalls: [{
          toolCallId: 'list-1',
          toolName: 'lsDir',
          state: 'output-available',
          input: { dir_path: '.' },
          output: 'files',
        }],
        isComplete: true,
        isActive: false,
      },
      {
        stepIndex: 1,
        purposeText: '入口已经定位，继续核对设计说明。',
        thinking: '入口已经定位，继续核对设计说明。',
        toolCalls: [{
          toolCallId: 'read-1',
          toolName: 'readFile',
          state: 'output-available',
          input: { file_path: 'PRODUCT.md' },
          output: 'content',
        }],
        isComplete: true,
        isActive: false,
      },
      {
        stepIndex: 2,
        purposeText: '修改已明确。',
        thinking: '修改已明确。',
        toolCalls: [{
          toolCallId: 'edit-1',
          toolName: 'edit',
          state: 'output-available',
          input: { file_path: 'src/app.ts' },
          output: 'done',
        }],
        isComplete: true,
        isActive: false,
      },
    ])

    expect(groups).toHaveLength(2)
    expect(groups[0].toolCalls.map(tool => tool.toolCallId)).toEqual(['list-1', 'read-1'])
    expect(groups[0].thinking).toBe('先确认目录结构。\n入口已经定位，继续核对设计说明。')
    expect(groups[1].toolCalls[0].toolCallId).toBe('edit-1')
  })

  it('summarizes a mixed tool batch in one readable sentence', () => {
    expect(describeToolBatch([
      {
        toolCallId: 'read-1',
        toolName: 'readFile',
        state: 'output-available',
        input: { file_path: 'package.json' },
        output: 'content',
      },
      {
        toolCallId: 'read-2',
        toolName: 'readFile',
        state: 'output-available',
        input: { file_path: 'tsconfig.json' },
        output: 'content',
      },
      {
        toolCallId: 'bash-1',
        toolName: 'bash',
        state: 'output-available',
        input: { command: 'pnpm test' },
        output: 'passed',
      },
    ])).toBe('已读取 2 个文件并运行 1 个命令')
  })

  it('keeps running and partial failure states in the batch summary', () => {
    expect(describeToolBatch([
      {
        toolCallId: 'grep-1',
        toolName: 'grep',
        state: 'input-available',
        input: { pattern: 'ToolCall' },
        output: undefined,
      },
      {
        toolCallId: 'grep-2',
        toolName: 'grep',
        state: 'output-error',
        input: { pattern: 'ToolResult' },
        output: undefined,
        errorText: 'failed',
      },
    ])).toBe('正在查询 2 项内容，部分失败')
  })

  it('accumulates distinct live rationales without repeating identical ones', () => {
    const base = {
      schemaVersion: 1 as const,
      runId: 'run-progress',
      conversationId: 'conversation-1',
      messageId: 'assistant-1',
      phase: 'executing' as const,
      timestamp: '2026-07-22T10:00:00.000Z',
    }
    let snapshot = applyAgentPublicEvent(undefined, {
      ...base,
      seq: 1,
      type: 'step.started',
      stepIndex: 0,
      data: {},
    })
    snapshot = applyAgentPublicEvent(snapshot, {
      ...base,
      seq: 2,
      type: 'progress.committed',
      stepIndex: 0,
      data: { text: '批量读取入口文件，确认整体结构。' },
    })
    snapshot = applyAgentPublicEvent(snapshot, {
      ...base,
      seq: 3,
      type: 'progress.committed',
      stepIndex: 0,
      data: { text: '批量读取入口文件，确认整体结构。' },
    })
    snapshot = applyAgentPublicEvent(snapshot, {
      ...base,
      seq: 4,
      type: 'progress.committed',
      stepIndex: 0,
      data: { text: '入口指向引擎层，再核对执行边界。' },
    })

    expect(snapshot.steps[0].progressText).toBe(
      '批量读取入口文件，确认整体结构。\n入口指向引擎层，再核对执行边界。',
    )
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
