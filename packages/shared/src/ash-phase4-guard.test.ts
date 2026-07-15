import { describe, expect, it } from 'vitest'
const { literalMcpCredentialGuard } = require('../../../scripts/verify/ash-phase4-guard.ts') as { literalMcpCredentialGuard: RegExp }

describe('ASH Phase 4 projection DTO credential guard', () => {
  it.each(['http_headers.Authorization', 'bearer_token = "literal"', 'env.API_KEY', 'url.userinfo', 'url.query.token', 'https://user:pass@example.test/mcp', 'https://example.test/mcp?token=literal'])('rejects literal MCP credential shape %s', (fixture) => {
    expect(literalMcpCredentialGuard.test(fixture)).toBe(true)
  })

  it.each(['envHttpHeaders', 'bearerTokenEnvVar', 'secretReferenceId', 'https://example.test/mcp?safe=yes', 'https://example.test/mcp?monkey=banana'])('permits reference-only or sanitized shape %s', (fixture) => {
    expect(literalMcpCredentialGuard.test(fixture)).toBe(false)
  })
})
