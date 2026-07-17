import type { StorageOperationProgress } from '@manta/shared'
import type { StorageOperation } from './storage-api'

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const

export function formatStorageBytes(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'Unavailable'

  const bytes = Math.max(0, value)
  let unitIndex = bytes === 0
    ? 0
    : Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), BYTE_UNITS.length - 1)

  while (true) {
    const amount = bytes / 1024 ** unitIndex
    const digits = amount >= 10 || Number.isInteger(amount) ? 0 : 1
    const roundedAmount = Number(amount.toFixed(digits))

    if (roundedAmount >= 1024 && unitIndex < BYTE_UNITS.length - 1) {
      unitIndex += 1
      continue
    }

    return `${roundedAmount} ${BYTE_UNITS[unitIndex]}`
  }
}

export function formatFileCount(value: number): string {
  if (!Number.isFinite(value)) return 'Unavailable'
  const count = Math.floor(Math.max(0, value))
  return `${new Intl.NumberFormat('en-US').format(count)} ${count === 1 ? 'file' : 'files'}`
}

export function storageHealthLabel(value: string): string {
  if (value === 'Not assigned') return value
  return humanizeStorageState(value)
}

export function humanizeStorageState(value: string): string {
  const words = value.trim().replace(/[-_]+/g, ' ')
  return words.length ? `${words[0]!.toUpperCase()}${words.slice(1)}` : 'Unknown'
}

export function formatStorageProgress(progress: StorageOperationProgress): {
  phase: string
  message: string
  metrics: string[]
} {
  const phase = humanizeStorageState(progress.phase)
  const rawMessage = progress.message.trim()
  const machineMessage = /^[a-z0-9]+(?:[-_][a-z0-9]+)+$/i.test(rawMessage)
  const normalizedMessage = machineMessage ? humanizeStorageState(rawMessage) : rawMessage
  const message = !normalizedMessage || normalizedMessage.toLowerCase() === phase.toLowerCase()
    ? 'Operation in progress'
    : normalizedMessage
  const metrics: string[] = []
  if (progress.currentGroup) metrics.push(`Group: ${humanizeStorageState(progress.currentGroup)}`)
  if (progress.filesTotal > 0) {
    metrics.push(`${new Intl.NumberFormat('en-US').format(progress.filesCompleted)} / ${new Intl.NumberFormat('en-US').format(progress.filesTotal)} files`)
  }
  if (progress.bytesTotal > 0) {
    metrics.push(`${formatStorageBytes(progress.bytesCompleted)} / ${formatStorageBytes(progress.bytesTotal)}`)
  }
  return { phase, message, metrics }
}

export function formatStorageOperation(operation: StorageOperation): {
  phase: string
  message: string
  metrics: string[]
} {
  const failed = operation.status === 'failed' || operation.phase === 'failed'
  if (failed) {
    const message = typeof operation.error === 'string'
      ? operation.error
      : operation.error?.message ?? 'Storage operation failed.'
    return { phase: 'Failed', message, metrics: [] }
  }

  const completed = operation.status === 'succeeded' || operation.phase === 'completed'
  if (completed) {
    return { phase: 'Completed', message: 'Storage operation completed.', metrics: [] }
  }

  return operation.progress
    ? formatStorageProgress(operation.progress)
    : {
        phase: humanizeStorageState(operation.phase),
        message: 'Operation in progress',
        metrics: [],
      }
}

export function storageHealthTone(
  value: string,
): 'healthy' | 'warning' | 'danger' | 'neutral' {
  if (
    value === 'healthy'
    || value === 'succeeded'
    || value === 'detected'
    || value === 'completed'
    || value === 'committed'
  ) return 'healthy'
  if (
    value === 'offline'
    || value === 'scanning'
    || value === 'recovering'
    || value === 'warning'
    || value === 'applying'
    || value === 'running'
    || value === 'rolling-back'
    || value === 'rolling_back'
  ) {
    return 'warning'
  }
  if (
    value === 'unreadable'
    || value === 'conflict'
    || value === 'failed'
    || value === 'error'
    || value === 'unhealthy'
  ) {
    return 'danger'
  }
  return 'neutral'
}
