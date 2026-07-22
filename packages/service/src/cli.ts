#!/usr/bin/env node
import { startLocalService } from './index.js'

async function main(): Promise<void> {
  const handle = await startLocalService({
    home: process.env.MANTA_HOME,
    bootstrapPath: process.env.MANTA_BOOTSTRAP_PATH,
    port: process.env.MANTA_PORT ? Number.parseInt(process.env.MANTA_PORT, 10) : undefined,
    bundledSeedRoot: process.env.MANTA_BUNDLED_ASSETS_DIR,
    initializeExtensions: process.env.MANTA_SKIP_STARTUP !== '1',
    qdrantBinary: process.env.MANTA_QDRANT_BINARY,
    qdrantUrl: process.env.QDRANT_URL,
    frontendDist: process.env.MANTA_FRONTEND_DIST,
  })
  process.stdout.write(`MANTA_SERVICE_READY ${JSON.stringify(handle.descriptor)}\n`)
  let stopping = false
  const stop = () => {
    if (stopping) return
    stopping = true
    void handle.close().then(() => process.exit(0), (error) => {
      process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
      process.exit(1)
    })
  }
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
  await handle.waitUntilClosed()
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
  process.exit(1)
})
