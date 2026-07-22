#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createLocalManta } from '@manta/sdk/node'
import * as z from 'zod/v4'

async function main(): Promise<void> {
  const manta = await createLocalManta({ home: process.env.MANTA_HOME, tokenProfile: 'mcp' })
  const server = new McpServer({ name: 'manta-ai', version: '0.1.0' })

  server.registerTool('manta_knowledge_bases_list', {
    description: 'List knowledge bases stored in the local Manta desktop application.',
    inputSchema: {},
  }, async () => result(await manta.knowledgeBases.list()))

  server.registerTool('manta_knowledge_search', {
    description: 'Search a local Manta knowledge base and return source-grounded chunks.',
    inputSchema: {
      knowledgeBaseId: z.string().min(1),
      query: z.string().min(1),
      topK: z.number().int().positive().max(100).optional(),
      threshold: z.number().min(0).max(1).optional(),
    },
  }, async ({ knowledgeBaseId, query, topK, threshold }) => result(await manta.knowledge.search({ knowledgeBaseId, query, ...(topK === undefined ? {} : { topK }), ...(threshold === undefined ? {} : { threshold }) })))

  server.registerTool('manta_document_add', {
    description: 'Upload a local document to Manta and enqueue durable background ingestion. Returns a Job immediately.',
    inputSchema: {
      knowledgeBaseId: z.string().min(1),
      filePath: z.string().min(1),
      idempotencyKey: z.string().min(1).optional(),
    },
  }, async ({ knowledgeBaseId, filePath, idempotencyKey }) => {
    const bytes = await readFile(filePath)
    if (!bytes.length) throw new Error('Document must not be empty')
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const requestKey = idempotencyKey ?? `document:${knowledgeBaseId}:${sha256}`
    const created = await manta.documents.createUploadSession(knowledgeBaseId, {
      name: basename(filePath), mediaType: documentMediaType(filePath), size: bytes.length, sha256,
    }, { idempotencyKey: requestKey }) as { data: { id: string; status: string; partSize: number; partCount: number; receivedParts: Array<{ number: number }> } }
    const received = new Set(created.data.receivedParts.map((part) => part.number))
    if (created.data.status !== 'completed') {
      for (let number = 0; number < created.data.partCount; number++) {
        if (received.has(number)) continue
        const part = bytes.subarray(number * created.data.partSize, Math.min(bytes.length, (number + 1) * created.data.partSize))
        const body = part.buffer.slice(part.byteOffset, part.byteOffset + part.byteLength) as ArrayBuffer
        await manta.documents.uploadPart(created.data.id, number, new Blob([body]), { sha256: createHash('sha256').update(part).digest('hex') })
      }
    }
    const completed = await manta.documents.completeUploadSession(created.data.id) as { data: { asset: { assetId: string } } }
    return result(await manta.documents.ingest(knowledgeBaseId, { assetId: completed.data.asset.assetId }, { idempotencyKey: requestKey }))
  })

  server.registerTool('manta_job_get', {
    description: 'Get a durable Manta Job snapshot.',
    inputSchema: { jobId: z.string().min(1) },
  }, async ({ jobId }) => result(await manta.jobs.retrieve(jobId)))

  server.registerTool('manta_job_list', {
    description: 'List recent durable Manta Jobs.',
    inputSchema: { limit: z.number().int().positive().max(200).optional() },
  }, async ({ limit }) => result(await manta.jobs.list({ limit })))

  server.registerTool('manta_job_wait', {
    description: 'Wait briefly for a Manta Job. If the timeout expires, returns the latest snapshot without cancelling the Job.',
    inputSchema: { jobId: z.string().min(1), timeoutMs: z.number().int().min(100).max(120_000).default(30_000) },
  }, async ({ jobId, timeoutMs }) => {
    try { return result(await manta.jobs.wait(jobId, { timeoutMs })) }
    catch (error) {
      if (error instanceof DOMException && error.name === 'TimeoutError') return result(await manta.jobs.retrieve(jobId))
      throw error
    }
  })

  server.registerTool('manta_job_cancel', {
    description: 'Explicitly cancel a durable Manta Job.',
    inputSchema: { jobId: z.string().min(1) },
  }, async ({ jobId }) => result(await manta.jobs.cancel(jobId)))

  server.registerTool('manta_job_retry', {
    description: 'Retry a failed, cancelled, or recovery-required Manta Job.',
    inputSchema: { jobId: z.string().min(1) },
  }, async ({ jobId }) => result(await manta.jobs.retry(jobId)))

  server.registerTool('manta_job_recover', {
    description: 'Resolve a Manta Job whose side effects require an explicit recovery decision.',
    inputSchema: {
      jobId: z.string().min(1),
      decision: z.enum(['retry-step', 'skip-step', 'fail']),
      reason: z.string().optional(),
    },
  }, async ({ jobId, decision, reason }) => result(await manta.jobs.resolveRecovery(jobId, { decision, reason })))

  server.registerTool('manta_job_input', {
    description: 'Provide user input or an approval decision to a Manta Job that is waiting_for_input.',
    inputSchema: {
      jobId: z.string().min(1),
      input: z.record(z.string(), z.unknown()),
    },
  }, async ({ jobId, input }) => result(await manta.jobs.provideInput(jobId, input as never)))

  server.registerTool('manta_agent_run', {
    description: 'Start a durable local Manta Agent run. Returns a Job immediately.',
    inputSchema: {
      conversationId: z.string().min(1),
      prompt: z.string().min(1),
      agentName: z.string().min(1).optional(),
      workspaceId: z.string().min(1).optional(),
      idempotencyKey: z.string().min(1).optional(),
    },
  }, async ({ conversationId, prompt, agentName, workspaceId, idempotencyKey }) => result(await manta.agents.run({ conversationId, prompt, ...(agentName ? { agentName } : {}), ...(workspaceId ? { workspaceId } : {}) }, { idempotencyKey })))

  server.registerTool('manta_skill_list', {
    description: 'List local Manta Skills and their authorization status.',
    inputSchema: {},
  }, async () => result(await manta.skills.list()))

  server.registerTool('manta_skill_run', {
    description: 'Run an already-authorized local Manta Skill as a durable Job. This tool cannot grant new permissions.',
    inputSchema: {
      skillId: z.string().min(1),
      input: z.record(z.string(), z.unknown()).default({}),
      idempotencyKey: z.string().min(1).optional(),
    },
  }, async ({ skillId, input, idempotencyKey }) => result(await manta.skills.run(skillId, input as never, { idempotencyKey })))

  await server.connect(new StdioServerTransport())
}

function result(value: unknown) {
  const text = JSON.stringify(value, null, 2)
  return { content: [{ type: 'text' as const, text }], structuredContent: toObject(value) }
}

function toObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : { value }
}

function documentMediaType(path: string): string {
  const types: Record<string, string> = {
    '.txt': 'text/plain', '.md': 'text/markdown', '.markdown': 'text/markdown', '.csv': 'text/csv',
    '.pdf': 'application/pdf',
    '.doc': 'application/msword', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.ppt': 'application/vnd.ms-powerpoint', '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  }
  return types[extname(path).toLowerCase()] ?? 'application/octet-stream'
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
  process.exitCode = 1
})
