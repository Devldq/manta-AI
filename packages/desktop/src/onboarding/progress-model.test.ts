import { describe, expect, it } from 'vitest'
import { applyProgressEvent, createProgressRows, resetProgressForRetry } from './progress-model'

describe('onboarding progress model', () => {
  it('starts with all nine real initialization rows pending', () => {
    const rows = createProgressRows()

    expect(rows).toHaveLength(9)
    expect(rows.map((row) => row.state)).toEqual(Array(9).fill('pending'))
    expect(rows.map((row) => row.id)).toEqual([
      'validate-parent', 'create-volume', 'create-groups', 'write-manifest', 'commit-bootstrap',
      'verify-storage', 'initialize-services', 'start-backend', 'open-main',
    ])
  })

  it('advances only the event row and preserves earlier completion', () => {
    let rows = createProgressRows()
    rows = applyProgressEvent(rows, { step: 'validate-parent', state: 'active' })
    rows = applyProgressEvent(rows, { step: 'validate-parent', state: 'complete' })
    rows = applyProgressEvent(rows, { step: 'create-volume', state: 'active' })

    expect(rows[0].state).toBe('complete')
    expect(rows[1].state).toBe('active')
    expect(rows.slice(2).every((row) => row.state === 'pending')).toBe(true)
  })

  it('stores a safe failure message and resets only the failed and later rows for retry', () => {
    let rows = createProgressRows()
    rows = applyProgressEvent(rows, { step: 'validate-parent', state: 'complete' })
    rows = applyProgressEvent(rows, { step: 'create-volume', state: 'complete' })
    rows = applyProgressEvent(rows, { step: 'create-groups', state: 'failed', message: '无法创建目录' })

    expect(rows[2]).toMatchObject({ state: 'failed', message: '无法创建目录' })
    rows = resetProgressForRetry(rows)
    expect(rows.slice(0, 2).map((row) => row.state)).toEqual(['complete', 'complete'])
    expect(rows.slice(2).every((row) => row.state === 'pending' && row.message === undefined)).toBe(true)
  })

  it('adds a user-safe row message when the main process omits internal error details', () => {
    const rows = applyProgressEvent(createProgressRows(), { step: 'start-backend', state: 'failed' })

    expect(rows[7]).toMatchObject({
      state: 'failed',
      message: '启动 Backend 并完成健康检查失败，请重试。',
    })
  })

  it('ignores stale regressive events for a completed row', () => {
    let rows = createProgressRows()
    rows = applyProgressEvent(rows, { step: 'commit-bootstrap', state: 'complete' })
    rows = applyProgressEvent(rows, { step: 'commit-bootstrap', state: 'active' })
    rows = applyProgressEvent(rows, { step: 'commit-bootstrap', state: 'failed', message: 'stale' })

    expect(rows[4]).toMatchObject({ state: 'complete', message: undefined })
  })
})
