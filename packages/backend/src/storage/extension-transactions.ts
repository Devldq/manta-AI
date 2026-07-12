import { cpSync, existsSync, mkdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'

interface ExtensionTransactionOptions {
  extensionsRoot: string
  destination: string
}

interface InstallOptions extends ExtensionTransactionOptions {
  source: string
  validate?: (stagedPath: string) => void
}

function assertDestination(options: ExtensionTransactionOptions): void {
  if (!isAbsolute(options.extensionsRoot) || !isAbsolute(options.destination)) throw new Error('Extension transaction paths must be absolute')
  const rel = relative(resolve(options.extensionsRoot), resolve(options.destination))
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error('Extension destination must be a child of the ASH extensions root')
  }
  if (existsSync(options.extensionsRoot)) {
    const realRoot = realpathSync(options.extensionsRoot)
    let ancestor = options.destination
    while (!existsSync(ancestor)) {
      const parent = dirname(ancestor)
      if (parent === ancestor) break
      ancestor = parent
    }
    const realAncestor = realpathSync(ancestor)
    const realRelative = relative(realRoot, realAncestor)
    if (realRelative === '..' || realRelative.startsWith(`..${sep}`) || isAbsolute(realRelative)) {
      throw new Error('Extension destination resolves outside the ASH extensions root')
    }
  }
}

export function transactionalInstallDirectory(options: InstallOptions): { transactionId: string; stagingPath: string; backupPath?: string } {
  assertDestination(options)
  const transactionId = randomUUID()
  const stagingPath = resolve(options.extensionsRoot, '.ash-staging', transactionId, 'payload')
  const backupPath = existsSync(options.destination)
    ? resolve(options.extensionsRoot, '.ash-backups', transactionId, relative(options.extensionsRoot, options.destination))
    : undefined
  mkdirSync(dirname(stagingPath), { recursive: true })
  cpSync(options.source, stagingPath, { recursive: true, dereference: false, filter: (source) => !['node_modules', '.git'].includes(source.split(/[\\/]/).at(-1) ?? '') })
  options.validate?.(stagingPath)
  try {
    if (backupPath) { mkdirSync(dirname(backupPath), { recursive: true }); renameSync(options.destination, backupPath) }
    mkdirSync(dirname(options.destination), { recursive: true })
    renameSync(stagingPath, options.destination)
    rmSync(resolve(options.extensionsRoot, '.ash-staging', transactionId), { recursive: true, force: true })
    return { transactionId, stagingPath, backupPath }
  } catch (error) {
    rmSync(stagingPath, { recursive: true, force: true })
    if (backupPath && existsSync(backupPath) && !existsSync(options.destination)) renameSync(backupPath, options.destination)
    throw error
  }
}

export function transactionalUninstallDirectory(options: ExtensionTransactionOptions): string | undefined {
  assertDestination(options)
  if (!existsSync(options.destination)) return undefined
  const transactionId = randomUUID()
  const backupPath = resolve(options.extensionsRoot, '.ash-backups', transactionId, relative(options.extensionsRoot, options.destination))
  mkdirSync(dirname(backupPath), { recursive: true })
  renameSync(options.destination, backupPath)
  return backupPath
}

export function transactionalWriteExtensionFile(options: ExtensionTransactionOptions & { content: string }): { backupPath?: string } {
  assertDestination(options)
  const transactionId = randomUUID()
  const stagingPath = resolve(options.extensionsRoot, '.ash-staging', transactionId, 'payload')
  const backupPath = existsSync(options.destination)
    ? resolve(options.extensionsRoot, '.ash-backups', transactionId, relative(options.extensionsRoot, options.destination))
    : undefined
  mkdirSync(dirname(stagingPath), { recursive: true })
  writeFileSync(stagingPath, options.content, 'utf8')
  try {
    if (backupPath) { mkdirSync(dirname(backupPath), { recursive: true }); renameSync(options.destination, backupPath) }
    mkdirSync(dirname(options.destination), { recursive: true })
    renameSync(stagingPath, options.destination)
    rmSync(resolve(options.extensionsRoot, '.ash-staging', transactionId), { recursive: true, force: true })
    return { backupPath }
  } catch (error) {
    rmSync(stagingPath, { force: true })
    if (backupPath && existsSync(backupPath) && !existsSync(options.destination)) renameSync(backupPath, options.destination)
    throw error
  }
}
