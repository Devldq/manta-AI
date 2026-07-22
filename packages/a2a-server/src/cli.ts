#!/usr/bin/env node
import { createLocalManta } from '@manta/sdk/node'
import { startA2AServer } from './index.js'

async function main(): Promise<void> {
  const token = process.env.MANTA_A2A_TOKEN
  if (!token) throw new Error('MANTA_A2A_TOKEN is required; A2A is local-only but never unauthenticated')
  const manta = await createLocalManta({ home: process.env.MANTA_HOME, tokenProfile: 'mcp' })
  const handle = await startA2AServer({ manta, token, port: process.env.MANTA_A2A_PORT ? Number(process.env.MANTA_A2A_PORT) : undefined })
  process.stdout.write(`MANTA_A2A_READY ${JSON.stringify({ endpoint: handle.endpoint })}\n`)
  const stop = () => void handle.close().finally(() => process.exit(0))
  process.once('SIGINT', stop); process.once('SIGTERM', stop)
}

main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`); process.exitCode = 1 })
