import { useEffect, useRef, useState } from 'react'
import type { StorageOperationProgress } from '@manta/shared'
import { desktopStorageBridge } from './desktop-storage-bridge'
import { storageApi, type StorageOperation } from './storage-api'

export function useStorageOperation() {
  const [operation, setOperation] = useState<StorageOperation | undefined>()
  const [error, setError] = useState<Error | undefined>()
  const operationId = useRef<string | undefined>(undefined)
  useEffect(() => {
    const bridge = desktopStorageBridge(); if (!bridge) return
    return bridge.subscribeProgress((progress: StorageOperationProgress) => { if (progress.operationId === operationId.current) setOperation({ id: progress.operationId, phase: progress.phase, progress }) })
  }, [])
  useEffect(() => {
    if (!operationId.current || ['completed', 'failed'].includes(operation?.phase ?? '')) return
    const interval = window.setInterval(() => { const id = operationId.current; if (id) storageApi.operation(id).then(setOperation).catch(setError) }, 1_000)
    return () => window.clearInterval(interval)
  }, [operation?.phase])
  return {
    operation, error,
    busy: !!operation && !['completed', 'failed'].includes(operation.phase),
    begin(id: string) { operationId.current = id; setOperation({ id, phase: 'planned' }); setError(undefined) },
    resume(next: StorageOperation | undefined) {
      if (!next?.id) return
      operationId.current = next.id
      setOperation(next)
      setError(undefined)
    },
  }
}
