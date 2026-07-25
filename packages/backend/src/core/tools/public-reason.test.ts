import { describe, expect, it, vi } from 'vitest'
import { transformChunk } from '../engine/stream-transformer.js'
import { ToolRegistry } from './registry/registry.js'
import {
  PUBLIC_TOOL_REASON_FIELD,
  getPublicToolReason,
  matchesUserLanguage,
  normalizePublicToolReason,
  setPublicToolReason,
  validatePublicToolInput,
  withPublicToolReason,
  withoutPublicToolReason,
} from './public-reason.js'

describe('public tool rationale protocol', () => {
  it('requires a model-authored rationale in every tool schema', () => {
    const schema = withPublicToolReason({
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    })

    expect(schema.required).toEqual(['path', PUBLIC_TOOL_REASON_FIELD])
    expect(schema.properties).toMatchObject({
      [PUBLIC_TOOL_REASON_FIELD]: {
        type: 'string',
        minLength: 8,
        maxLength: 240,
      },
    })
    expect(JSON.stringify(schema.properties)).toContain('avoid repetitive report-style openings')
    expect(JSON.stringify(schema.properties)).toContain('Do not narrate the literal tool operation')
    expect(JSON.stringify(schema.properties)).toContain('engine.ts 把检索交给 Pipeline')
  })

  it('extracts the rationale and removes it from the real tool input', () => {
    const input = {
      path: 'src/app.ts',
      [PUBLIC_TOOL_REASON_FIELD]: '入口已经定位到 app.ts，读取它可以确认初始化顺序。',
    }

    expect(getPublicToolReason(input)).toBe('入口已经定位到 app.ts，读取它可以确认初始化顺序。')
    expect(withoutPublicToolReason(input)).toEqual({ path: 'src/app.ts' })
  })

  it('rejects missing reasons and can attach a normalized repair', () => {
    expect(validatePublicToolInput({ path: 'src/app.ts' })).toMatchObject({
      success: false,
      error: { message: 'PUBLIC_TOOL_REASON_REQUIRED' },
    })

    const reason = normalizePublicToolReason('  已确认根入口存在。\n读取文件可以核对版本字段。  ')
    expect(reason).toBe('已确认根入口存在。 读取文件可以核对版本字段。')
    expect(setPublicToolReason({ path: 'src/app.ts' }, reason!)).toEqual({
      path: 'src/app.ts',
      [PUBLIC_TOOL_REASON_FIELD]: reason,
    })
  })

  it('rejects serialized tool protocol and enforces the user language for repair', () => {
    expect(normalizePublicToolReason('Next tool: read Tool input: {"path":"a"}')).toBeUndefined()
    expect(normalizePublicToolReason('<tool_call>read <arg_key>path</arg_key></tool_call>')).toBeUndefined()
    expect(matchesUserLanguage('I will inspect the file to verify its version.', '请检查版本')).toBe(false)
    expect(matchesUserLanguage('读取文件以核对版本是否一致。', '请检查版本')).toBe(true)
  })

  it('strips protocol metadata before invoking a builtin tool', async () => {
    const execute = vi.fn(async () => 'ok')
    const registry = new ToolRegistry()
    registry.register({
      name: 'readFile',
      description: 'Read a file',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
      },
      execute,
    })

    const tool = registry.toAISDKFormat().readFile
    expect(tool.inputSchema.jsonSchema.required).toContain(PUBLIC_TOOL_REASON_FIELD)
    expect(await tool.inputSchema.validate({ path: 'src/app.ts' })).toMatchObject({
      success: false,
    })

    await tool.execute({
      path: 'src/app.ts',
      [PUBLIC_TOOL_REASON_FIELD]: '需要读取入口文件，确认启动逻辑。',
    })

    expect(execute).toHaveBeenCalledWith({ path: 'src/app.ts' })
  })

  it('publishes only the clean tool input after the rationale boundary', () => {
    expect(transformChunk({
      type: 'tool-input-start',
      id: 'call-1',
      toolName: 'readFile',
    })).toBeNull()
    expect(transformChunk({
      type: 'tool-input-delta',
      id: 'call-1',
      delta: '{"path":"src/app.ts"}',
    })).toBeNull()
    expect(transformChunk({
      type: 'tool-call',
      toolCallId: 'call-1',
      toolName: 'readFile',
      input: {
        path: 'src/app.ts',
        [PUBLIC_TOOL_REASON_FIELD]: '需要读取入口文件，确认启动逻辑。',
      },
    })).toMatchObject({
      type: 'tool-input-available',
      input: { path: 'src/app.ts' },
    })
  })
})
