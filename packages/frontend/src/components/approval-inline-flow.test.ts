import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8')
const providerSource = readFileSync(new URL('./ApprovalProvider.tsx', import.meta.url), 'utf8')
const composerSource = readFileSync(new URL('../pages/tasks/components/KimInputBar.tsx', import.meta.url), 'utf8')
const cardSource = readFileSync(new URL('../pages/tasks/components/InlineApproval.tsx', import.meta.url), 'utf8')

describe('inline approval flow', () => {
  it('keeps the reconnecting approval transport above the routed pages', () => {
    expect(appSource).toContain('<ApprovalProvider>')
    expect(providerSource).toContain("new EventSource('/api/approval/sse')")
    expect(providerSource).toContain("fetch('/api/approval/pending')")
    expect(providerSource).toContain('只相信服务端的最终状态')
    expect(providerSource).toContain('if (respondingRef.current) return')
  })

  it('renders approval controls inside the task composer instead of a portal modal', () => {
    expect(composerSource).toContain('<InlineApproval />')
    expect(cardSource).toContain('className="approval-inline-card"')
    expect(cardSource).toContain('秒后自动拒绝')
    expect(cardSource).not.toContain('createPortal')
    expect(appSource).not.toContain('ApprovalDialog')
  })
})
