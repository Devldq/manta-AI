import { describe, expect, it } from 'vitest'
import { planGroupConflicts } from './conflict-planner'

const hash = (letter: string) => letter.repeat(64)

describe('planGroupConflicts', () => {
  it('accepts remote-only and disjoint changes without a user conflict', () => {
    const plan = planGroupConflicts({
      base: { work: hash('a'), extensions: hash('a') },
      local: { work: hash('a'), extensions: hash('b') },
      remote: { work: hash('c'), extensions: hash('a') },
    })

    expect(plan.groups).toEqual(expect.arrayContaining([
      expect.objectContaining({ group: 'work', state: 'remote-only', defaultChoice: 'keep-remote' }),
      expect.objectContaining({ group: 'extensions', state: 'local-only', defaultChoice: 'keep-local' }),
    ]))
  })

  it('requires an explicit decision for a changed database group and supports immutable duplicate assets', () => {
    const plan = planGroupConflicts({
      base: { knowledge: hash('a'), extensions: hash('a') },
      local: { knowledge: hash('b'), extensions: hash('b') },
      remote: { knowledge: hash('c'), extensions: hash('c') },
    })

    expect(plan.groups).toEqual(expect.arrayContaining([
      expect.objectContaining({ group: 'knowledge', state: 'database-conflict', choices: ['keep-local', 'keep-remote'] }),
      expect.objectContaining({ group: 'extensions', state: 'conflict', choices: ['keep-local', 'keep-remote', 'duplicate-asset'] }),
    ]))
    expect(plan.requiresConfirmation).toBe(true)
  })

  it('classifies an immutable remote addition as safe to import', () => {
    const plan = planGroupConflicts({ base: {}, local: {}, remote: { extensions: hash('d') } })
    expect(plan.groups).toEqual([expect.objectContaining({ group: 'extensions', state: 'remote-addition', defaultChoice: 'keep-remote' })])
  })
})
