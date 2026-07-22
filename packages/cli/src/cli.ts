#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { open, readFile, stat } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import { createLocalManta, discoverLocalMantaHome, ensureLocalService, localServiceStatus, stopLocalService } from '@manta/sdk/node'
import { serviceLogPath } from '@manta/service'
import type Manta from '@manta/sdk'

interface ParsedArgs { positionals: string[]; flags: Map<string, string | true> }

async function main(): Promise<void> {
  const [resource, action, ...rest] = process.argv.slice(2)
  const args = parseArgs(rest)
  if (!resource || ['help', '--help', '-h'].includes(resource)) return printHelp()
  const mantaHome = flag(args, 'home') ?? await discoverLocalMantaHome()
  if (resource === 'service') return serviceCommand(action, args, mantaHome)
  const manta = await createLocalManta({ home: mantaHome })
  if (resource === 'job') return jobCommand(manta, action, args)
  if (resource === 'knowledge') return knowledgeCommand(manta, action, args)
  if (resource === 'document') return documentCommand(manta, action, args)
  if (resource === 'strategy') return strategyCommand(manta, action, args)
  if (resource === 'eval') return evaluationCommand(manta, action, args)
  if (resource === 'agent') return agentCommand(manta, action, args)
  if (resource === 'skill') return skillCommand(manta, action, args)
  throw new Error(`Unknown command: ${resource}`)
}

async function serviceCommand(action: string | undefined, args: ParsedArgs, mantaHome: string): Promise<void> {
  if (action === 'start') return print(await ensureLocalService({ home: mantaHome }))
  if (action === 'stop') return print({ stopped: await stopLocalService(mantaHome) })
  if (action === 'status') return print(await localServiceStatus(mantaHome))
  if (action === 'logs') {
    const lines = Number(flag(args, 'lines') ?? 100)
    const content = await readFile(serviceLogPath(mantaHome), 'utf8').catch(() => '')
    process.stdout.write(`${content.split('\n').slice(-Math.max(1, lines)).join('\n')}\n`)
    return
  }
  throw new Error('Usage: manta service start|stop|status|logs')
}

async function jobCommand(manta: Manta, action: string | undefined, args: ParsedArgs): Promise<void> {
  if (action === 'list') return print(await manta.jobs.list({ limit: numberFlag(args, 'limit'), status: flag(args, 'status') as never, kind: flag(args, 'kind') as never }))
  const id = required(args.positionals[0], 'job id')
  if (action === 'get') return print(await manta.jobs.retrieve(id))
  if (action === 'cancel') return print(await manta.jobs.cancel(id))
  if (action === 'retry') return print(await manta.jobs.retry(id))
  if (action === 'input') return print(await manta.jobs.provideInput(id, parseJson(required(flag(args, 'input'), '--input JSON'))))
  if (action === 'recover') {
    const decision = (flag(args, 'decision') ?? args.positionals[1]) as 'retry-step' | 'skip-step' | 'fail'
    if (!['retry-step', 'skip-step', 'fail'].includes(decision)) throw new Error('--decision must be retry-step, skip-step, or fail')
    return print(await manta.jobs.resolveRecovery(id, { decision, reason: flag(args, 'reason') }))
  }
  if (action === 'watch') {
    const snapshot = await manta.jobs.retrieve(id)
    print(snapshot)
    for await (const event of manta.jobs.events(id, { afterSeq: snapshot.eventSeq })) print(event)
    print(await manta.jobs.retrieve(id))
    return
  }
  throw new Error('Usage: manta job list|get|watch|cancel|retry|recover|input')
}

async function knowledgeCommand(manta: Manta, action: string | undefined, args: ParsedArgs): Promise<void> {
  if (action === 'list') return print(await manta.knowledgeBases.list())
  if (action === 'search') {
    const query = required(args.positionals.join(' ') || flag(args, 'query'), 'query')
    const topK = numberFlag(args, 'top-k'); const threshold = numberFlag(args, 'threshold')
    return print(await manta.knowledge.search({ knowledgeBaseId: required(flag(args, 'kb'), '--kb'), query, ...(topK === undefined ? {} : { topK }), ...(threshold === undefined ? {} : { threshold }) }))
  }
  throw new Error('Usage: manta knowledge list|search')
}

async function documentCommand(manta: Manta, action: string | undefined, args: ParsedArgs): Promise<void> {
  if (action !== 'add') throw new Error('Usage: manta document add <path> --kb <knowledge-base-id>')
  const path = required(args.positionals[0], 'document path')
  const knowledgeBaseId = required(flag(args, 'kb'), '--kb')
  const [file, sha256] = await Promise.all([stat(path), hashFile(path)])
  if (!file.isFile() || file.size <= 0) throw new Error('document path must reference a non-empty file')
  const idempotencyKey = flag(args, 'idempotency-key') ?? `document:${knowledgeBaseId}:${sha256}`
  const created = await manta.documents.createUploadSession(knowledgeBaseId, {
    name: basename(path), mediaType: documentMediaType(path), size: file.size, sha256,
  }, { idempotencyKey }) as { data: UploadSession }
  let session = created.data
  if (session.status !== 'completed') {
    const received = new Set(session.receivedParts.map((part) => part.number))
    const handle = await open(path, 'r')
    try {
      for (let number = 0; number < session.partCount; number++) {
        if (received.has(number)) continue
        const length = number === session.partCount - 1 ? file.size - session.partSize * number : session.partSize
        const bytes = await readRange(handle, session.partSize * number, length)
        const partSha256 = createHash('sha256').update(bytes).digest('hex')
        const response = await manta.documents.uploadPart(session.id, number, blobFromBytes(bytes), { sha256: partSha256 }) as { data: UploadSession }
        session = response.data
      }
    } finally { await handle.close() }
  }
  const completed = await manta.documents.completeUploadSession(session.id) as { data: { asset: { assetId: string } } }
  const submitted = await manta.documents.ingest(knowledgeBaseId, { assetId: completed.data.asset.assetId }, { idempotencyKey })
  print(submitted)
}

interface UploadSession {
  id: string
  status: 'uploading' | 'completed'
  partSize: number
  partCount: number
  receivedParts: Array<{ number: number }>
}

async function hashFile(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

async function readRange(handle: Awaited<ReturnType<typeof open>>, position: number, length: number): Promise<Uint8Array> {
  const bytes = new Uint8Array(length)
  let offset = 0
  while (offset < length) {
    const result = await handle.read(bytes, offset, length - offset, position + offset)
    if (!result.bytesRead) throw new Error(`document ended before byte ${position + length}`)
    offset += result.bytesRead
  }
  return bytes
}

function blobFromBytes(bytes: Uint8Array): Blob {
  return new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer])
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

async function strategyCommand(manta: Manta, action: string | undefined, args: ParsedArgs): Promise<void> {
  if (action === 'list') return print(await manta.strategies.list(required(flag(args, 'kb'), '--kb')))
  const id = required(args.positionals[0], 'strategy id')
  if (action === 'build') return print(await manta.strategies.build(id))
  if (action === 'activate') return print(await manta.strategies.activate(id))
  throw new Error('Usage: manta strategy list|build|activate')
}

async function evaluationCommand(manta: Manta, action: string | undefined, args: ParsedArgs): Promise<void> {
  if (action === 'run') return print(await manta.evaluations.run(parseJson(required(flag(args, 'input'), '--input JSON'))))
  if (action === 'compare') return print(await manta.evaluations.compare(args.positionals))
  throw new Error('Usage: manta eval run|compare')
}

async function agentCommand(manta: Manta, action: string | undefined, args: ParsedArgs): Promise<void> {
  if (action !== 'run') throw new Error('Usage: manta agent run --input JSON')
  print(await manta.agents.run(parseJson(required(flag(args, 'input'), '--input JSON'))))
}

async function skillCommand(manta: Manta, action: string | undefined, args: ParsedArgs): Promise<void> {
  if (action === 'list') return print(await manta.skills.list())
  if (action === 'get') return print(await manta.skills.retrieve(required(args.positionals[0], 'skill id')))
  if (action === 'authorize') {
    const id = required(args.positionals[0], 'skill id')
    const detail = await manta.skills.retrieve(id) as { data: { requiredPermissions: string[] } }
    return print(await manta.skills.authorize(id, detail.data.requiredPermissions))
  }
  if (action === 'revoke') return print(await manta.skills.revokeAuthorization(required(args.positionals[0], 'skill id')))
  if (action === 'run') return print(await manta.skills.run(required(args.positionals[0], 'skill id'), parseJson(flag(args, 'input') ?? '{}')))
  throw new Error('Usage: manta skill list|get|authorize|revoke|run')
}

function parseArgs(values: string[]): ParsedArgs {
  const positionals: string[] = []
  const flags = new Map<string, string | true>()
  for (let index = 0; index < values.length; index++) {
    const value = values[index]
    if (!value.startsWith('--')) { positionals.push(value); continue }
    const [name, inline] = value.slice(2).split('=', 2)
    if (inline !== undefined) flags.set(name, inline)
    else if (values[index + 1] && !values[index + 1].startsWith('--')) flags.set(name, values[++index])
    else flags.set(name, true)
  }
  return { positionals, flags }
}

function flag(args: ParsedArgs, name: string): string | undefined { const value = args.flags.get(name); return typeof value === 'string' ? value : undefined }
function numberFlag(args: ParsedArgs, name: string): number | undefined { const value = flag(args, name); if (value === undefined) return undefined; const parsed = Number(value); if (!Number.isFinite(parsed)) throw new Error(`--${name} must be a number`); return parsed }
function required<T>(value: T | undefined | '', label: string): T { if (value === undefined || value === '') throw new Error(`${label} is required`); return value }
function parseJson(value: string): any { try { return JSON.parse(value) } catch { throw new Error('Input must be valid JSON') } }
function print(value: unknown): void { process.stdout.write(`${JSON.stringify(value, null, 2)}\n`) }

function printHelp(): void {
  process.stdout.write(`Manta local knowledge CLI\n\n` +
    `  manta service start|stop|status|logs\n` +
    `  manta knowledge list|search --kb <id> <query>\n` +
    `  manta document add <path> --kb <id>\n` +
    `  manta job list|get|watch|cancel|retry|recover|input\n` +
    `  manta strategy list|build|activate\n` +
    `  manta eval run|compare\n` +
    `  manta agent run\n` +
    `  manta skill list|get|authorize|revoke|run\n`)
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
