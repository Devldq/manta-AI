import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import {
  formatFileCount,
  formatStorageProgress,
  formatStorageBytes,
  humanizeStorageState,
  storageHealthLabel,
  storageHealthTone,
} from './storage-ui'
import * as storageUi from './storage-ui'

describe('storage UI formatting', () => {
  it('keeps primary Storage actions above the WCAG AA text contrast threshold', () => {
    const css = readFileSync(new URL('./storage.css', import.meta.url), 'utf8')
    const rgb = (hex: string) => {
      const value = hex.replace('#', '')
      return [0, 2, 4].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16))
    }
    const luminance = (hex: string) => {
      const [red, green, blue] = rgb(hex).map((channel) => {
        const value = channel! / 255
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
      })
      return 0.2126 * red! + 0.7152 * green! + 0.0722 * blue!
    }
    const contrast = (foreground: string, background: string) => {
      const first = luminance(foreground)
      const second = luminance(background)
      return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05)
    }

    expect(css).toContain('--storage-accent: #047857')
    expect(css).toContain('--storage-accent-hover: #065f46')
    expect(css).toContain('--storage-accent-foreground: #fff')
    expect(css).toContain('background: var(--storage-accent)')
    expect(css).toContain('color: var(--storage-accent-foreground)')
    expect(contrast('#ffffff', '#047857')).toBeGreaterThanOrEqual(4.5)
    expect(contrast('#ffffff', '#065f46')).toBeGreaterThanOrEqual(4.5)
  })

  it.each([
    [0, '0 B'],
    [623, '623 B'],
    [2048, '2 KB'],
    [2_621_440, '2.5 MB'],
    [4_796_804, '4.6 MB'],
    [1023.5, '1 KB'],
    [1_048_575, '1 MB'],
    [10_239, '10 KB'],
  ])('formats %s bytes as %s', (value, expected) => {
    expect(formatStorageBytes(value)).toBe(expected)
  })

  it.each([null, undefined, Number.NaN, Number.POSITIVE_INFINITY])(
    'uses a stable unavailable byte label for %s',
    (value) => {
      expect(formatStorageBytes(value)).toBe('Unavailable')
    },
  )

  it('normalizes negative byte values to zero', () => {
    expect(formatStorageBytes(-1)).toBe('0 B')
  })

  it.each([
    [1, '1 file'],
    [1243, '1,243 files'],
    [-1, '0 files'],
    [1243.9, '1,243 files'],
    [Number.NaN, 'Unavailable'],
    [Number.POSITIVE_INFINITY, 'Unavailable'],
  ])('formats %s as %s', (value, expected) => {
    expect(formatFileCount(value)).toBe(expected)
  })

  it.each([
    ['healthy', 'Healthy'],
    ['', 'Unknown'],
    ['not-assigned', 'Not assigned'],
  ])('normalizes the %s health label', (value, expected) => {
    expect(storageHealthLabel(value)).toBe(expected)
  })

  it.each([
    ['healthy', 'healthy'],
    ['succeeded', 'healthy'],
    ['detected', 'healthy'],
    ['offline', 'warning'],
    ['scanning', 'warning'],
    ['recovering', 'warning'],
    ['warning', 'warning'],
    ['unreadable', 'danger'],
    ['conflict', 'danger'],
    ['failed', 'danger'],
    ['error', 'danger'],
    ['unhealthy', 'danger'],
    ['Not assigned', 'neutral'],
    ['unexpected', 'neutral'],
  ] as const)('maps %s health to the %s tone', (value, expected) => {
    expect(storageHealthTone(value)).toBe(expected)
  })

  it('humanizes machine operation phases and gives active/completed states truthful tones', () => {
    expect(humanizeStorageState('awaiting-new-process-health')).toBe('Awaiting new process health')
    expect(humanizeStorageState('rolled_back')).toBe('Rolled back')
    expect(storageHealthTone('applying')).toBe('warning')
    expect(storageHealthTone('running')).toBe('warning')
    expect(storageHealthTone('committed')).toBe('healthy')
    expect(storageHealthTone('completed')).toBe('healthy')
    expect(storageHealthTone('rolled-back')).toBe('neutral')
  })

  it('formats structured operation progress without repeating a raw phase', () => {
    expect(formatStorageProgress({
      operationId: 'operation-1',
      operationKind: 'group',
      phase: 'awaiting-new-process-health',
      currentGroup: 'knowledge',
      filesCompleted: 1200,
      filesTotal: 2400,
      bytesCompleted: 1_048_576,
      bytesTotal: 2_097_152,
      message: 'awaiting-new-process-health',
    })).toEqual({
      phase: 'Awaiting new process health',
      message: 'Operation in progress',
      metrics: ['Group: Knowledge', '1,200 / 2,400 files', '1 MB / 2 MB'],
    })
  })

  it('formats terminal storage operations without reusing stale progress', () => {
    const format = (storageUi as typeof storageUi & {
      formatStorageOperation?: (operation: {
        id: string
        phase: string
        status?: string
        progress?: Parameters<typeof formatStorageProgress>[0]
        error?: string | { code: string; message: string }
      }) => { phase: string; message: string; metrics: string[] }
    }).formatStorageOperation

    expect(format).toBeTypeOf('function')
    expect(format?.({
      id: 'completed',
      phase: 'completed',
      status: 'succeeded',
      progress: {
        operationId: 'completed',
        operationKind: 'group',
        phase: 'copying',
        filesCompleted: 1,
        filesTotal: 2,
        bytesCompleted: 10,
        bytesTotal: 20,
        message: 'copying',
      },
    })).toEqual({ phase: 'Completed', message: 'Storage operation completed.', metrics: [] })
    expect(format?.({
      id: 'failed',
      phase: 'failed',
      status: 'failed',
      error: { code: 'copy-failed', message: 'Destination became unavailable' },
    })).toEqual({ phase: 'Failed', message: 'Destination became unavailable', metrics: [] })
  })
})
