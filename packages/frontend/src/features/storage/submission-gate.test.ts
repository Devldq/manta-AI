import { describe, expect, it } from 'vitest'
import { createSubmissionGate } from './submission-gate'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((nextResolve, nextReject) => { resolve = nextResolve; reject = nextReject })
  return { promise, resolve, reject }
}

describe('createSubmissionGate', () => {
  it('accepts only one deferred confirm dispatch and reports controls disabled until it settles', async () => {
    const states: boolean[] = []
    const gate = createSubmissionGate((busy) => states.push(busy))
    const pending = deferred<void>()
    let calls = 0
    const action = () => { calls += 1; return pending.promise }

    const first = gate.run(action)
    const second = gate.run(action)

    expect(calls).toBe(1)
    expect(gate.busy).toBe(true)
    expect(states).toEqual([true])
    await second
    pending.resolve()
    await first
    expect(gate.busy).toBe(false)
    expect(states).toEqual([true, false])
  })

  it('unlocks after an error so the visible dialog error can be retried', async () => {
    const gate = createSubmissionGate(() => {})
    const failure = new Error('migration failed')

    await expect(gate.run(async () => { throw failure })).rejects.toBe(failure)
    expect(gate.busy).toBe(false)

    await gate.run(async () => {})
    expect(gate.busy).toBe(false)
  })
})
