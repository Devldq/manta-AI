import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const sidebarSource = readFileSync(new URL('../SessionSidebar.tsx', import.meta.url), 'utf8')
const reviewSource = readFileSync(new URL('./ReviewTab.tsx', import.meta.url), 'utf8')
const filesSource = readFileSync(new URL('./FilesTab.tsx', import.meta.url), 'utf8')
const styles = readFileSync(new URL('../../index.css', import.meta.url), 'utf8')

describe('workspace sidebar layout', () => {
  it('supports pointer and keyboard resizing with persisted width bounds', () => {
    expect(sidebarSource).toContain("SIDEBAR_WIDTH_STORAGE_KEY = 'manta:workspace-sidebar-width'")
    expect(sidebarSource).toContain('setPointerCapture(event.pointerId)')
    expect(sidebarSource).toContain("event.key === 'ArrowLeft'")
    expect(sidebarSource).toContain("event.key === 'ArrowRight'")
    expect(sidebarSource).toContain('window.localStorage.setItem')
    expect(sidebarSource).toContain('MIN_MAIN_CONTENT_WIDTH')
  })

  it('uses matching left-navigation and right-preview structures', () => {
    expect(reviewSource).toContain('workspace-review-navigation')
    expect(reviewSource).toContain('workspace-review-preview')
    expect(filesSource).toContain('workspace-file-tree')
    expect(filesSource).toContain('workspace-file-preview')
    expect(styles).toContain('.workspace-review-body')
    expect(styles).toContain('flex-direction: row')
    expect(styles).toContain('width: clamp(184px, 32%, 280px)')
  })

  it('falls back to a stacked layout on small screens', () => {
    expect(styles).toContain('@media (max-width: 767px)')
    expect(styles).toContain('.workspace-review-body,')
    expect(styles).toContain('.workspace-files {')
    expect(styles).toContain('flex-direction: column')
  })
})
