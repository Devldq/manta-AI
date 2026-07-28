import { describe, expect, it } from 'vitest'
import { detectCyclicRepeat, detectLoop } from './detectors'
import { computeCallKey, simpleHash } from './fingerprint'
import type { ToolCallFingerprint } from './types'

function call(
  toolName: string,
  input: unknown,
  output: unknown,
  stepIndex: number,
): ToolCallFingerprint {
  return {
    callHash: simpleHash(computeCallKey(toolName, input)),
    outputHash: simpleHash(JSON.stringify(output)),
    toolName,
    input,
    output,
    stepIndex,
  }
}

const investigationCycle = [
  ['read', { file_path: 'src/main.rs' }],
  ['read', { file_path: 'src/commands.rs' }],
  ['read', { file_path: 'package.json' }],
  ['read', { file_path: 'Cargo.toml' }],
] as const

function repeatedInvestigation(cycles: number): ToolCallFingerprint[] {
  return Array.from({ length: cycles }, (_, cycleIndex) =>
    investigationCycle.map(([toolName, input], offset) =>
      call(toolName, input, `content-${offset}`, cycleIndex),
    ),
  ).flat()
}

describe('cyclic loop detection', () => {
  it('detects the repeated four-file investigation from the incident', () => {
    expect(detectCyclicRepeat(repeatedInvestigation(2))).toMatchObject({
      type: 'cyclic-repeat',
      severity: 'warning',
      repeatCount: 8,
    })
    expect(detectCyclicRepeat(repeatedInvestigation(3))).toMatchObject({
      severity: 'critical',
      repeatCount: 12,
    })
    expect(detectCyclicRepeat(repeatedInvestigation(4))).toMatchObject({
      severity: 'circuit-breaker',
      repeatCount: 16,
    })
  })

  it('still trips after the detector sliding window has discarded older calls', () => {
    expect(detectLoop(repeatedInvestigation(20), 30)).toMatchObject({
      type: 'cyclic-repeat',
      severity: 'circuit-breaker',
    })
  })

  it('does not report a cycle when the next investigation changes a target', () => {
    const history = repeatedInvestigation(1)
    history.push(
      call('read', { file_path: 'src/main.rs' }, 'content-0', 1),
      call('read', { file_path: 'src/commands.rs' }, 'content-1', 1),
      call('read', { file_path: 'tauri.conf.json' }, 'new-content', 1),
      call('read', { file_path: 'Cargo.toml' }, 'content-3', 1),
    )

    expect(detectCyclicRepeat(history)).toBeNull()
  })
})
