import { appendFile, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { followLogFile } from './followLogFile'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })

describe('followLogFile', () => {
  it('forwards only content appended after following begins', async () => {
    const root = await mkdtemp(join(tmpdir(), 'manta-log-follow-')); roots.push(root)
    const path = join(root, 'service.log')
    await writeFile(path, 'old\n')
    let output = ''
    const stop = await followLogFile(path, (chunk) => { output += chunk }, 10)
    await appendFile(path, 'new\n')
    await expect.poll(() => output).toBe('new\n')
    stop()
  })

  it('starts following a file created later', async () => {
    const root = await mkdtemp(join(tmpdir(), 'manta-log-follow-')); roots.push(root)
    const path = join(root, 'service.log')
    let output = ''
    const stop = await followLogFile(path, (chunk) => { output += chunk }, 10)
    await writeFile(path, 'started\n')
    await expect.poll(() => output).toBe('started\n')
    stop()
  })
})
