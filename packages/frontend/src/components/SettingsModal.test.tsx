import { readFileSync } from 'node:fs'
import * as settingsModalModule from './SettingsModal'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('./SettingsModal.tsx', import.meta.url), 'utf8')
const indexCss = readFileSync(new URL('../index.css', import.meta.url), 'utf8')
const runtime = settingsModalModule as unknown as Record<string, unknown>

type FakeElement = HTMLElement & {
  append(child: FakeElement): void
  computedStyle: { display: string; visibility: string }
  focusCount: number
}

function fakeElement(
  tagName: string,
  options: { attributes?: Record<string, string>; disabled?: boolean; tabIndex?: number; display?: string; visibility?: string } = {},
): FakeElement {
  const attributes = new Map(Object.entries(options.attributes ?? {}))
  const node = {
    tagName: tagName.toUpperCase(),
    parentElement: null,
    children: [] as FakeElement[],
    disabled: options.disabled ?? false,
    tabIndex: options.tabIndex ?? 0,
    computedStyle: {
      display: options.display ?? 'block',
      visibility: options.visibility ?? 'visible',
    },
    focusCount: 0,
    append(child: FakeElement) {
      Object.defineProperty(child, 'parentElement', { value: node, configurable: true })
      node.children.push(child)
    },
    focus() { node.focusCount += 1 },
    hasAttribute(name: string) { return attributes.has(name) },
    getAttribute(name: string) { return attributes.get(name) ?? null },
    matches(selector: string) { return selector === ':disabled' && node.disabled },
    ownerDocument: {
      defaultView: {
        getComputedStyle(target: FakeElement) { return target.computedStyle },
      },
    },
  }
  return node as unknown as FakeElement
}

function runtimeFunction(name: string): (...args: never[]) => unknown {
  const value = runtime[name]
  expect(value, `${name} must be exported for behavioral coverage`).toBeTypeOf('function')
  return value as (...args: never[]) => unknown
}

describe('SettingsModal shell', () => {
  it('exposes modal, tab, panel, close, and color-mode semantics', () => {
    expect(source).toContain('role="dialog"')
    expect(source).toContain('aria-modal="true"')
    expect(source).toContain('aria-label="Settings"')
    expect(source).toContain('role="tablist"')
    expect(source).toContain('role="tab"')
    expect(source).toContain('aria-selected={activeTab === key}')
    expect(source).toContain('aria-controls={`settings-panel-${key}`}')
    expect(source).toContain('role="tabpanel"')
    expect(source).toContain('aria-labelledby={`settings-tab-${activeTab}`}')
    expect(source).toContain('aria-label="Close settings"')
    expect(source).toContain("aria-pressed={colorMode === 'light'}")
    expect(source).toContain("aria-pressed={colorMode === 'dark'}")
  })

  it('renders the three backend-owned agent approval scopes', () => {
    expect(source).toContain('role="radiogroup"')
    expect(source).toContain('aria-label="Agent 授权范围"')
    expect(source).toContain('role="radio"')
    expect(source).toContain('aria-checked={selected}')
    expect(source).toContain("mode: 'request' as const")
    expect(source).toContain("mode: 'auto' as const")
    expect(source).toContain("mode: 'full' as const")
    expect(source).toContain("fetch('/api/approval/policy')")
    expect(source).toContain("method: 'PUT'")
    expect(source).toContain('confirmFullAccess')
    expect(source).toContain('对新任务生效')
    expect(source).toContain('aria-label="审批等待时间"')
    expect(source).toContain('超时自动拒绝')
    expect(source).toContain('完全访问立即允许')
    expect(source).toContain('className="approval-policy-controls"')
    expect(indexCss).toMatch(/@media \(max-width: 420px\)[\s\S]*\.approval-policy-controls\s*\{[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\)/)
  })

  it('calculates the standard arrow, Home, and End tab destinations', () => {
    const nextTab = runtimeFunction('getNextSettingsTab')
    expect(nextTab('theme' as never, 'ArrowRight' as never)).toBe('settings')
    expect(nextTab('theme' as never, 'ArrowLeft' as never)).toBe('storage')
    expect(nextTab('llm' as never, 'Home' as never)).toBe('theme')
    expect(nextTab('theme' as never, 'End' as never)).toBe('storage')
    expect(nextTab('theme' as never, 'Tab' as never)).toBeNull()
  })

  it('uses the fixed Manta command palette while Storage is active', () => {
    const getShellTheme = runtimeFunction('getSettingsShellTheme')
    expect(getShellTheme('theme' as never, 'light' as never)).toEqual({})
    expect(getShellTheme('storage' as never, 'light' as never)).toMatchObject({
      '--color-background': '#f8f6f0',
      '--color-surface': '#ffffff',
      '--color-accent': '#047857',
      '--color-accent-hover': '#065f46',
      '--color-text-inverse': '#ffffff',
      '--color-status-failed': '#b42318',
    })
    expect(getShellTheme('storage' as never, 'dark' as never)).toMatchObject({
      '--color-background': '#0a0a14',
      '--color-surface': '#141420',
      '--color-surface-elevated': '#1e1e2e',
      '--color-accent': '#047857',
      '--color-selection-foreground': '#6ee7b7',
      '--color-text-inverse': '#ffffff',
      '--color-status-failed': '#f97066',
    })
  })

  it('keeps selected navigation legible on the Deep Abyss surface', () => {
    const getShellTheme = runtimeFunction('getSettingsShellTheme')
    const theme = getShellTheme('storage' as never, 'dark' as never) as Record<string, string>
    const channels = (hex: string) => [0, 2, 4].map((offset) => Number.parseInt(hex.slice(1 + offset, 3 + offset), 16) / 255)
    const luminance = (hex: string) => {
      const [red, green, blue] = channels(hex).map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
      return 0.2126 * red! + 0.7152 * green! + 0.0722 * blue!
    }
    const foreground = luminance(theme['--color-selection-foreground']!)
    const background = luminance(theme['--color-accent-subtle']!)

    expect((Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05)).toBeGreaterThanOrEqual(4.5)
  })

  it('includes summary but excludes closed-details, hidden, disabled, and aria-hidden controls', () => {
    const getTabbable = runtimeFunction('getSettingsModalTabbableElements')
    const dialog = fakeElement('div', { tabIndex: -1 })
    const first = fakeElement('button')
    const closedDetails = fakeElement('details')
    const summary = fakeElement('summary')
    const closedButton = fakeElement('button')
    const hiddenButton = fakeElement('button', { display: 'none' })
    const disabledButton = fakeElement('button', { disabled: true })
    const ariaHidden = fakeElement('div', { attributes: { 'aria-hidden': 'true' } })
    const ariaHiddenButton = fakeElement('button')
    closedDetails.append(summary)
    closedDetails.append(closedButton)
    ariaHidden.append(ariaHiddenButton)
    dialog.append(first)
    dialog.append(closedDetails)
    dialog.append(hiddenButton)
    dialog.append(disabledButton)
    dialog.append(ariaHidden)
    let selector = ''
    ;(dialog as unknown as { querySelectorAll(value: string): FakeElement[] }).querySelectorAll = (value) => {
      selector = value
      return [first, summary, closedButton, hiddenButton, disabledButton, ariaHiddenButton]
    }

    expect(getTabbable(dialog as never)).toEqual([first, summary])
    expect(selector).toContain('summary')
  })

  it('wraps only at the real boundary of closed and opened details', () => {
    const trapTab = runtimeFunction('trapSettingsModalTabFocus')
    const dialog = fakeElement('div', { tabIndex: -1 })
    const first = fakeElement('button')
    const details = fakeElement('details')
    const summary = fakeElement('summary')
    const detailButton = fakeElement('button')
    details.append(summary)
    details.append(detailButton)
    dialog.append(first)
    dialog.append(details)
    ;(dialog as unknown as { querySelectorAll(value: string): FakeElement[] }).querySelectorAll = () => [first, summary, detailButton]
    let prevented = 0
    const event = { shiftKey: false, preventDefault: () => { prevented += 1 } }

    trapTab(event as never, dialog as never, summary as never)
    expect(prevented).toBe(1)
    expect(first.focusCount).toBe(1)

    ;(details as unknown as { hasAttribute(name: string): boolean }).hasAttribute = (name) => name === 'open'
    prevented = 0
    first.focusCount = 0
    trapTab(event as never, dialog as never, summary as never)
    expect(prevented).toBe(0)
    expect(first.focusCount).toBe(0)
  })

  it('detects nested modal events and restores only a connected opener', () => {
    const isNested = runtimeFunction('isNestedSettingsModalEvent')
    const restore = runtimeFunction('restoreSettingsModalOpener')
    const dialog = fakeElement('div')
    const nested = fakeElement('div')
    const nestedTarget = fakeElement('button')
    ;(nestedTarget as unknown as { closest(selector: string): FakeElement }).closest = () => nested
    expect(isNested(nestedTarget as never, dialog as never)).toBe(true)
    ;(nestedTarget as unknown as { closest(selector: string): FakeElement }).closest = () => dialog
    expect(isNested(nestedTarget as never, dialog as never)).toBe(false)

    const opener = fakeElement('button')
    ;(opener as unknown as { isConnected: boolean }).isConnected = true
    restore(opener as never)
    expect(opener.focusCount).toBe(1)
    ;(opener as unknown as { isConnected: boolean }).isConnected = false
    restore(opener as never)
    expect(opener.focusCount).toBe(1)
  })

  it('closes only for an exact backdrop target', () => {
    const shouldClose = runtimeFunction('shouldCloseSettingsBackdrop')
    const backdrop = fakeElement('div')
    expect(shouldClose(backdrop as never, backdrop as never)).toBe(true)
    expect(shouldClose(fakeElement('button') as never, backdrop as never)).toBe(false)
  })

  it('keeps utilities fixed while the tab strip scrolls on narrow screens', () => {
    expect(source).toContain("flex: '1 1 auto'")
    expect(source).toContain('minWidth: 0')
    expect(source).toContain("overflowX: 'auto'")
    expect(source).toContain("whiteSpace: 'nowrap'")
    expect(source).toContain('flexShrink: 0')
    expect(source).toContain("maxWidth: '95vw'")
    expect(source).toContain("scrollIntoView({ block: 'nearest', inline: 'nearest' })")
    expect(source).toContain("window.addEventListener('resize', revealActiveTab)")
    expect(source).toContain('settings-color-mode__label')
    expect(source).toContain('className="settings-tab"')
    expect(source).toContain('aria-label="Light mode"')
    expect(source).toContain('aria-label="Dark mode"')
  })

  it('shows every settings destination without a hidden horizontal strip at 320px', () => {
    const css = readFileSync(new URL('../features/storage/storage.css', import.meta.url), 'utf8')
    expect(source).toContain('className="settings-header"')
    expect(source).toContain('className="settings-tabs"')
    expect(source).toContain('className="settings-utilities"')
    expect(css).toMatch(/@media \(max-width: 420px\)[\s\S]*\.settings-header\s*\{[\s\S]*flex-wrap:\s*wrap/)
    expect(css).toMatch(/@media \(max-width: 420px\)[\s\S]*\.settings-tabs\s*\{[\s\S]*grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\)/)
    expect(css).toMatch(/@media \(max-width: 420px\)[\s\S]*\.settings-tabs\s*\{[\s\S]*overflow:\s*visible/)
  })

  it('uses the flat Manta shell treatment', () => {
    const shellStyle = source.slice(source.indexOf("width: '780px'"), source.indexOf('{/* AI: 弹窗 Header */}'))
    expect(source).not.toContain('backdropFilter')
    expect(shellStyle).toContain("borderRadius: 'var(--radius-lg)'")
    expect(shellStyle).not.toContain('boxShadow')
    expect(shellStyle).not.toContain('0 24px 80px')
    expect(shellStyle).not.toContain('0 12px 32px')
  })

  it('reserves the solid Emerald treatment for actions instead of selected navigation', () => {
    expect(source).toContain("color: activeTab === key ? 'var(--color-selection-foreground, var(--color-accent))' : 'var(--color-text-secondary)'")
    expect(source).toContain("background: activeTab === key ? 'var(--color-accent-subtle)' : 'transparent'")
    expect(source).toContain("color: colorMode === 'light' ? 'var(--color-selection-foreground, var(--color-accent))' : 'var(--color-text-secondary)'")
    expect(source).toContain("background: colorMode === 'light' ? 'var(--color-accent-subtle)' : 'transparent'")
    expect(source).toContain("color: colorMode === 'dark' ? 'var(--color-selection-foreground, var(--color-accent))' : 'var(--color-text-secondary)'")
    expect(source).toContain("background: colorMode === 'dark' ? 'var(--color-accent-subtle)' : 'transparent'")
    expect(source).toContain("transition: 'background-color var(--duration-fast) var(--ease-out-quart), color var(--duration-fast) var(--ease-out-quart)'")
  })
})
