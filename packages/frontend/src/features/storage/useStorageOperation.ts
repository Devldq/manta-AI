import { useEffect, useRef, useState } from 'react'
import type { StorageOperationProgress } from '@manta/shared'
import { desktopStorageBridge } from './desktop-storage-bridge'
import { storageApi, type StorageOperation } from './storage-api'

export function selectResumableStorageOperation(currentId: string | undefined, operations: Array<StorageOperation | undefined>): StorageOperation | undefined {
  const candidates = operations.filter((value): value is StorageOperation => Boolean(value?.id))
  return candidates.find((value) => value.id === currentId)
    ?? candidates.find((value) => !['completed', 'failed'].includes(value.phase) && !['succeeded', 'failed'].includes(value.status ?? ''))
    ?? candidates[0]
}

export function useStorageOperation() {
  const [operation, setOperation] = useState<StorageOperation | undefined>()
  const [error, setError] = useState<Error | undefined>()
  const operationId = useRef<string | undefined>(undefined)
  useEffect(() => {
    const bridge = desktopStorageBridge(); if (!bridge) return
    return bridge.subscribeProgress((progress: StorageOperationProgress) => { if (progress.operationId === operationId.current) setOperation((current) => ({ ...current, id: progress.operationId, status: 'running', phase: progress.phase, progress })) })
  }, [])
  useEffect(() => {
    if (!operationId.current || ['completed', 'failed'].includes(operation?.phase ?? '') || ['succeeded', 'failed'].includes(operation?.status ?? '')) return
    const interval = window.setInterval(() => { const id = operationId.current; if (id) storageApi.operation(id).then(setOperation).catch(setError) }, 1_000)
    return () => window.clearInterval(interval)
  }, [operation?.phase])
  return {
    operation, error,
    busy: !!operation && !['completed', 'failed'].includes(operation.phase) && !['succeeded', 'failed'].includes(operation.status ?? ''),
    begin(id: string) { operationId.current = id; setOperation({ id, phase: 'planned', status: 'running' }); setError(undefined) },
    resume(next: StorageOperation | undefined, recent: StorageOperation[] = []) {
      const active = selectResumableStorageOperation(operationId.current, [next, ...recent])
      if (!active) return
      operationId.current = active.id
      setOperation(active)
      setError(undefined)
    },
  }
}
