import { describe, expect, it } from 'vitest'
import { DEFAULT_LLM_CONFIG } from './constants'

describe('shared defaults', () => {
  it('keeps the agent step limit at 200', () => {
    expect(DEFAULT_LLM_CONFIG.MAX_STEPS).toBe(200)
  })
})
