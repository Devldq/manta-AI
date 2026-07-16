export const ONBOARDING_PROGRESS_STEPS = [
  'validate-parent',
  'create-volume',
  'create-groups',
  'write-manifest',
  'commit-bootstrap',
  'verify-storage',
  'initialize-services',
  'start-backend',
  'open-main',
] as const

export type OnboardingProgressStepId = typeof ONBOARDING_PROGRESS_STEPS[number]
export type OnboardingProgressState = 'pending' | 'active' | 'complete' | 'failed'

export interface OnboardingProgressEvent {
  step: OnboardingProgressStepId
  state: Exclude<OnboardingProgressState, 'pending'>
  message?: string
}

export type OnboardingProgressReporter = (event: OnboardingProgressEvent) => void

export function isOnboardingProgressEvent(value: unknown): value is OnboardingProgressEvent {
  if (!value || typeof value !== 'object') return false
  const event = value as Partial<OnboardingProgressEvent>
  return ONBOARDING_PROGRESS_STEPS.includes(event.step as OnboardingProgressStepId)
    && ['active', 'complete', 'failed'].includes(event.state ?? '')
    && (event.message === undefined || typeof event.message === 'string')
}
