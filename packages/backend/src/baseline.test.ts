import { describe, expect, it } from 'vitest'
import { apiSuccess } from './core/api/error-handler'

describe('API success envelope', () => {
  it('wraps response data in the canonical success shape', () => {
    expect(apiSuccess({ ok: true })).toEqual({ success: true, data: { ok: true } })
  })
})
