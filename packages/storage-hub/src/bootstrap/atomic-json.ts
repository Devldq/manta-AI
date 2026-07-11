import { mkdir, open, rename, rm } from 'node:fs/promises'
import { dirname, basename, join } from 'node:path'
import { randomUUID } from 'node:crypto'

export async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })
  const temporaryPath = join(dirname(filePath), `${basename(filePath)}.${randomUUID()}.tmp`)
  const handle = await open(temporaryPath, 'wx')
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8')
    await handle.sync()
  } catch (error) {
    await handle.close()
    await rm(temporaryPath, { force: true })
    throw error
  }
  await handle.close()
  try {
    await rename(temporaryPath, filePath)
  } catch (error) {
    await rm(temporaryPath, { force: true })
    throw error
  }
}
