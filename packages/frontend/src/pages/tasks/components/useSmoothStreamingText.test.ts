import { describe, expect, it } from 'vitest'
import { getStreamingRevealRate, splitGraphemes } from './useSmoothStreamingText'

describe('smooth streaming text', () => {
  it('keeps grapheme clusters intact', () => {
    expect(splitGraphemes('A👨‍👩‍👧‍👦e\u0301中')).toEqual(['A', '👨‍👩‍👧‍👦', 'e\u0301', '中'])
  })

  it('uses a calm base rate and accelerates only when output accumulates', () => {
    expect(getStreamingRevealRate(20, true)).toBe(56)
    expect(getStreamingRevealRate(80, true)).toBe(88)
    expect(getStreamingRevealRate(200, true)).toBe(136)
    expect(getStreamingRevealRate(500, true)).toBe(220)
  })

  it('finishes a closed response without flashing or leaving a long tail', () => {
    expect(getStreamingRevealRate(20, false)).toBe(120)
    expect(getStreamingRevealRate(220, false)).toBe(400)
    expect(getStreamingRevealRate(1000, false)).toBe(900)
  })
})
