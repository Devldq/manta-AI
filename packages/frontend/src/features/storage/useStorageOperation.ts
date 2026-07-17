import { useEffect, useRef, useState } from 'react'
import type { StorageOperationProgress } from '@manta/shared'
import { desktopStorageBridge } from './desktop-storage-bridge'
import { storageApi, type StorageOperation } from './storage-api'

const TERMINAL_RECOVERY_GRACE_MS = 30_000
const rendererTerminalUpdatedAfter = new Date(Date.now() - TERMINAL_RECOVERY_GRACE_MS).toISOString()
let rendererOwnedOperationId: string | undefined
let terminalRecoveryConsumed = false

function isTerminalOperation(operation: StorageOperation | undefined): boolean {
  return !!operation && (
    ['completed', 'failed'].includes(operation.phase)
    || ['succeeded', 'failed'].includes(operation.status ?? '')
  )
}

function newestOperation(operations: StorageOperation[]): StorageOperation | undefined {
  return operations.reduce<StorageOperation | undefined>((latest, candidate) => {
    if (!latest) return candidate
    return (candidate.updatedAt ?? '') > (latest.updatedAt ?? '') ? candidate : latest
  }, undefined)
}

export function selectResumableStorageOperation(
  currentId: string | undefined,
  operations: Array<StorageOperation | undefined>,
  recovery: { ownedId?: string; terminalUpdatedAfter?: string } = {},
): StorageOperation | undefined {
  const candidates = operations.filter((value): value is StorageOperation => Boolean(value?.id))
  const current = candidates.find((value) => value.id === currentId)
  if (current) return current

  const running = newestOperation(candidates.filter((value) => !isTerminalOperation(value)))
  if (running) return running

  const latest = newestOperation(candidates)
  if (!latest || !isTerminalOperation(latest)) return undefined
  const rendererOwned = latest.id === recovery.ownedId
  const completedDuringRelaunch = !!(
    recovery.terminalUpdatedAfter
    && latest.updatedAt
    && latest.updatedAt >= recovery.terminalUpdatedAfter
  )
  return rendererOwned || completedDuringRelaunch ? latest : undefined
}

export function useStorageOperation() {
  const [operation, setOperation] = useState<StorageOperation | undefined>()
  const [error, setError] = useState<Error | undefined>()
  const operationId = useRef<string | undefined>(undefined)
  const ownedOperationId = useRef<string | undefined>(rendererOwnedOperationId)
  useEffect(() => {
    const bridge = desktopStorageBridge(); if (!bridge) return
    return bridge.subscribeProgress((progress: StorageOperationProgress) => { if (progress.operationId === operationId.current) setOperation((current) => ({ ...current, id: progress.operationId, status: 'running', phase: progress.phase, progress })) })
  }, [])
  useEffect(() => {
    if (!operationId.current || isTerminalOperation(operation)) return
    const interval = window.setInterval(() => {
      const id = operationId.current
      if (!id) return
      storageApi.operation(id).then((next) => {
        if (next.id !== operationId.current) return
        setOperation(next)
        setError(undefined)
        if (isTerminalOperation(next) && ownedOperationId.current === next.id) {
          ownedOperationId.current = undefined
          if (rendererOwnedOperationId === next.id) rendererOwnedOperationId = undefined
        }
      }).catch(setError)
    }, 1_000)
    return () => window.clearInterval(interval)
  }, [operation?.phase, operation?.status])
  return {
    operation, error,
    busy: !!operation && !isTerminalOperation(operation),
    begin(id: string) {
      operationId.current = id
      ownedOperationId.current = id
      rendererOwnedOperationId = id
      setOperation({ id, phase: 'planned', status: 'running' })
      setError(undefined)
    },
    resume(next: StorageOperation | undefined, recent: StorageOperation[] = []) {
      const active = selectResumableStorageOperation(operationId.current, [next, ...recent], {
        ownedId: ownedOperationId.current ?? rendererOwnedOperationId,
        terminalUpdatedAfter: terminalRecoveryConsumed ? undefined : rendererTerminalUpdatedAfter,
      })
      terminalRecoveryConsumed = true
      if (!active) return
      operationId.current = active.id
      setOperation(active)
      setError(undefined)
      if (isTerminalOperation(active)) {
        ownedOperationId.current = undefined
        if (rendererOwnedOperationId === active.id) rendererOwnedOperationId = undefined
      } else {
        ownedOperationId.current = active.id
        rendererOwnedOperationId = active.id
      }
    },
  }
}
