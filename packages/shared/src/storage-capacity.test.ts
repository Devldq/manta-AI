import { describe, expect, it } from 'vitest'
import { StorageCapacityMetricsSchema, aggregateStorageCapacityMetrics } from './storage'

const complete = (volumeId: string, logical: number, physical: number) => ({
  volumeId, scanStatus: 'complete' as const, logicalImmutableBytes: logical,
  physicalImmutableBytes: physical, verifiedDedupSavedBytes: Math.max(0, logical - physical),
  replicaBytes: 0, cleanableBytes: 0, scannedAt: '2026-07-14T00:00:00.000Z', blockers: [],
})

describe('storage capacity DTOs', () => {
  it('aggregates volume-local metrics without deduplicating identical content across volumes', () => {
    expect(aggregateStorageCapacityMetrics([complete('v1', 12, 8), complete('v2', 12, 8)]))
      .toMatchObject({ scanStatus: 'complete', logicalImmutableBytes: 24, physicalImmutableBytes: 16, verifiedDedupSavedBytes: 8 })
  })

  it('requires null physical and savings values for degraded scans', () => {
    expect(StorageCapacityMetricsSchema.safeParse({ ...complete('v1', 12, 8), scanStatus: 'degraded', physicalImmutableBytes: null, verifiedDedupSavedBytes: null, blockers: [{ code: 'allocation-unavailable', detail: 'allocation unavailable' }] }).success).toBe(true)
    expect(StorageCapacityMetricsSchema.safeParse({ ...complete('v1', 12, 8), scanStatus: 'degraded' }).success).toBe(false)
  })
})
