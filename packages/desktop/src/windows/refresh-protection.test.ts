import { describe, expect, it } from 'vitest'
import {
  createRefreshSafeMenuTemplate,
  isRendererRefreshShortcut,
  type RendererKeyboardInput,
} from './refresh-protection'

function input(patch: Partial<RendererKeyboardInput>): RendererKeyboardInput {
  return {
    type: 'keyDown',
    key: '',
    control: false,
    meta: false,
    ...patch,
  }
}

function collectRoles(items: ReturnType<typeof createRefreshSafeMenuTemplate>): string[] {
  const roles: string[] = []
  for (const item of items) {
    if (item.role) roles.push(item.role)
    if (Array.isArray(item.submenu)) roles.push(...collectRoles(item.submenu))
  }
  return roles
}

describe('desktop refresh protection', () => {
  it('blocks platform reload shortcuts and F5', () => {
    expect(isRendererRefreshShortcut(input({ key: 'r', meta: true }))).toBe(true)
    expect(isRendererRefreshShortcut(input({ key: 'R', control: true }))).toBe(true)
    expect(isRendererRefreshShortcut(input({ key: 'r', meta: true, control: false }))).toBe(true)
    expect(isRendererRefreshShortcut(input({ key: 'F5' }))).toBe(true)
  })

  it('does not block unrelated shortcuts or key-up events', () => {
    expect(isRendererRefreshShortcut(input({ key: 'r' }))).toBe(false)
    expect(isRendererRefreshShortcut(input({ key: 'c', meta: true }))).toBe(false)
    expect(isRendererRefreshShortcut(input({ type: 'keyUp', key: 'r', meta: true }))).toBe(false)
  })

  it('builds an application menu without reload actions', () => {
    const roles = collectRoles(createRefreshSafeMenuTemplate('darwin', false))
    expect(roles).toContain('editMenu')
    expect(roles).toContain('toggleDevTools')
    expect(roles).not.toContain('reload')
    expect(roles).not.toContain('forceReload')
  })
})
