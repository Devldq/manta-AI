import { describe, expect, it } from 'vitest'
import { isOnboardingProgressEvent } from './progress-contract'

describe('onboarding progress event validation', () => {
  it('accepts only known steps, renderer states, and string messages', () => {
    expect(isOnboardingProgressEvent({ step: 'start-backend', state: 'active' })).toBe(true)
    expect(isOnboardingProgressEvent({ step: 'unknown', state: 'active' })).toBe(false)
    expect(isOnboardingProgressEvent({ step: 'start-backend', state: 'pending' })).toBe(false)
    expect(isOnboardingProgressEvent({ step: 'start-backend', state: 'failed', message: { secret: true } })).toBe(false)
  })
})
