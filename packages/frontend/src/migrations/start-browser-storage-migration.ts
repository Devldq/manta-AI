import { clientState, type ClientStateKey } from '@/lib/client-state'
import { createBrowserStorageImporter, openBrowserStorageImportDatabaseWithFallback, openLegacyLocalStorageImportDatabase } from './browser-storage-importer'

const legacyKeys: Record<string, ClientStateKey> = { 'manta:theme': 'theme', 'manta:sidebar': 'sidebar', 'manta:webhook': 'webhook' }

function parseObject(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) return value as Record<string, unknown>
  if (typeof value !== 'string') return undefined
  try { const parsed = JSON.parse(value); return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined } catch { return undefined }
}

async function persistRecords(records: Record<string, unknown>): Promise<void> {
  for (const [sourceKey, raw] of Object.entries(records)) {
    const key = legacyKeys[sourceKey] ?? (sourceKey as ClientStateKey)
    if (!['theme', 'sidebar', 'webhook', 'browser-import'].includes(key)) continue
    const value = parseObject(raw)
    if (!value || !(await clientState.set(key, value))) throw new Error(`ASH client state write failed for ${key}`)
  }
}

/** Best-effort startup migration. Failure deliberately retains the browser copy. */
export async function migrateBrowserStorageToAsh(): Promise<void> {
  const v4 = await openBrowserStorageImportDatabaseWithFallback()
  await createBrowserStorageImporter({ database: v4.database, persist: persistRecords }).importOnce()
  await createBrowserStorageImporter({ database: openLegacyLocalStorageImportDatabase(), persist: persistRecords }).importOnce()
}
