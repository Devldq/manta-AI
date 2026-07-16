# Storage Command Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Subagents are not authorized for this workspace unless the user explicitly requests them. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the existing Storage settings page as a compact, accessible Manta “Task Commander” control surface without changing ASH behavior.

**Architecture:** Keep `StorageSettingsPanel` as the data orchestrator and preserve every existing API/IPC callback. Add a small Storage presentation layer (formatters, primitives, and scoped CSS), then reshape the volume, capacity, group, Agent, backup, and confirmation views around those primitives. All behavioral state remains in the current components; this plan changes presentation and progressive disclosure only.

**Tech Stack:** React 19, TypeScript, Vitest, React server rendering tests, Lucide React, scoped CSS imported by the Storage feature, existing Manta CSS variables.

## Global Constraints

- Scope is only the Storage page inside the existing Settings modal.
- Do not change Storage API, IPC, filesystem, migration, Git, or Agent operation semantics.
- Use Warm Stone / Deep Abyss themed variables and Emerald as the only primary action accent.
- Use flat surfaces, borders, and spacing; no decorative gradients, glass, glow, or wide shadows.
- Use `--radius-lg` or less and the existing 4pt spacing scale.
- Use `--duration-fast` / `--duration-normal` with `--ease-out-quart`.
- Preserve complete light/dark, focus-visible, keyboard, and reduced-motion behavior.
- Do not add dependencies.
- Do not commit, stage, push, or create a PR without explicit user authorization.

---

## File Map

- Create `packages/frontend/src/features/storage/storage-ui.ts`: pure formatting and health-label helpers.
- Create `packages/frontend/src/features/storage/storage-ui.test.ts`: focused unit tests for display formatting.
- Create `packages/frontend/src/features/storage/storage.css`: all Storage-scoped layout, component, responsive, focus, and motion styles.
- Create `packages/frontend/src/features/storage/StoragePrimitives.tsx`: page header, section heading, status badge, and loading skeleton.
- Modify `packages/frontend/src/features/storage/StorageSettingsPanel.tsx`: compose the redesigned page and preserve data/action flow.
- Modify `packages/frontend/src/features/storage/StorageVolumeCard.tsx`: compact volume facts and progressive Git disclosure.
- Modify `packages/frontend/src/features/storage/StorageOverview.tsx`: compact aggregate capacity and group inventory.
- Modify `packages/frontend/src/features/storage/StorageGroupRow.tsx`: readable inventory row and move prerequisite.
- Modify `packages/frontend/src/features/storage/AgentConnectionsSection.tsx`: apply the shared Storage visual vocabulary without changing operations.
- Modify `packages/frontend/src/features/storage/StorageOperationDialog.tsx`: Manta confirmation hierarchy, accessibility, and busy feedback.
- Modify `packages/frontend/src/features/storage/StorageSettingsPanel.test.tsx`: page, volume, group, Git, and dialog presentation regression coverage.
- Modify `packages/frontend/src/features/storage/AgentConnectionsSection.test.tsx`: Agent section presentation and behavior-preservation coverage.

---

### Task 1: Display Formatting Foundation

**Files:**
- Create: `packages/frontend/src/features/storage/storage-ui.ts`
- Create: `packages/frontend/src/features/storage/storage-ui.test.ts`

**Interfaces:**
- Produces: `formatStorageBytes(value: number | null | undefined): string`
- Produces: `formatFileCount(value: number): string`
- Produces: `storageHealthLabel(value: string): string`
- Produces: `storageHealthTone(value: string): 'healthy' | 'warning' | 'danger' | 'neutral'`

- [ ] **Step 1: Write failing formatter tests**

```ts
import { describe, expect, it } from 'vitest'
import { formatFileCount, formatStorageBytes, storageHealthLabel, storageHealthTone } from './storage-ui'

describe('storage UI formatting', () => {
  it.each([
    [0, '0 B'],
    [623, '623 B'],
    [2048, '2 KB'],
    [2_621_440, '2.5 MB'],
    [4_796_804, '4.6 MB'],
  ])('formats %s bytes as %s', (value, expected) => {
    expect(formatStorageBytes(value)).toBe(expected)
  })

  it('uses a stable unavailable label and readable file counts', () => {
    expect(formatStorageBytes(null)).toBe('Unavailable')
    expect(formatFileCount(1243)).toBe('1,243 files')
  })

  it('normalizes health labels and tones', () => {
    expect(storageHealthLabel('healthy')).toBe('Healthy')
    expect(storageHealthTone('conflict')).toBe('danger')
    expect(storageHealthTone('Not assigned')).toBe('neutral')
  })
})
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run:

```bash
pnpm --filter @manta/frontend exec vitest run src/features/storage/storage-ui.test.ts
```

Expected: FAIL because `storage-ui.ts` does not exist.

- [ ] **Step 3: Implement the pure helpers**

```ts
const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const

export function formatStorageBytes(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'Unavailable'
  const bytes = Math.max(0, value)
  if (bytes < 1024) return `${Math.round(bytes)} B`
  const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), BYTE_UNITS.length - 1)
  const amount = bytes / (1024 ** unitIndex)
  const digits = amount >= 10 || Number.isInteger(amount) ? 0 : 1
  return `${amount.toFixed(digits)} ${BYTE_UNITS[unitIndex]}`
}

export function formatFileCount(value: number): string {
  return `${new Intl.NumberFormat('en-US').format(Math.max(0, value))} files`
}

export function storageHealthLabel(value: string): string {
  if (value === 'Not assigned') return value
  return value.length ? `${value[0]!.toUpperCase()}${value.slice(1).replaceAll('-', ' ')}` : 'Unknown'
}

export function storageHealthTone(value: string): 'healthy' | 'warning' | 'danger' | 'neutral' {
  if (value === 'healthy' || value === 'succeeded' || value === 'detected') return 'healthy'
  if (value === 'offline' || value === 'scanning' || value === 'recovering') return 'warning'
  if (value === 'unreadable' || value === 'conflict' || value === 'failed' || value === 'error') return 'danger'
  return 'neutral'
}
```

- [ ] **Step 4: Re-run the focused test and confirm GREEN**

Run the command from Step 2. Expected: 1 test file and all cases pass.

- [ ] **Step 5: Review the task diff**

Run:

```bash
git diff --check -- packages/frontend/src/features/storage/storage-ui.ts packages/frontend/src/features/storage/storage-ui.test.ts
```

Expected: no output.

---

### Task 2: Storage Presentation Primitives and Scoped CSS

**Files:**
- Create: `packages/frontend/src/features/storage/StoragePrimitives.tsx`
- Create: `packages/frontend/src/features/storage/storage.css`
- Modify: `packages/frontend/src/features/storage/StorageSettingsPanel.test.tsx`

**Interfaces:**
- Consumes: `storageHealthLabel`, `storageHealthTone`
- Produces: `StoragePageHeader`, `StorageSection`, `StorageStatusBadge`, `StorageSkeleton`

- [ ] **Step 1: Add failing server-render tests for the primitives**

```tsx
import { StoragePageHeader, StorageSection, StorageSkeleton, StorageStatusBadge } from './StoragePrimitives'

it('renders the Storage command header and accessible primary action', () => {
  const html = renderToStaticMarkup(
    <StoragePageHeader healthy onCreate={() => {}} disabled={false} />
  )
  expect(html).toContain('Storage')
  expect(html).toContain('ASH storage')
  expect(html).toContain('Healthy')
  expect(html).toContain('Create volume')
  expect(html).toContain('storage-button--primary')
})

it('renders reusable section, status, and loading semantics', () => {
  const html = renderToStaticMarkup(<><StorageSection title="Volumes" description="Storage locations">Content</StorageSection><StorageStatusBadge value="conflict" /><StorageSkeleton /></>)
  expect(html).toContain('Storage locations')
  expect(html).toContain('data-tone="danger"')
  expect(html).toContain('aria-busy="true"')
})
```

- [ ] **Step 2: Run the focused presentation test and confirm RED**

```bash
pnpm --filter @manta/frontend exec vitest run src/features/storage/StorageSettingsPanel.test.tsx
```

Expected: FAIL because `StoragePrimitives.tsx` does not exist.

- [ ] **Step 3: Implement semantic primitives**

```tsx
import { Database, Plus } from 'lucide-react'
import type { ReactNode } from 'react'
import { storageHealthLabel, storageHealthTone } from './storage-ui'

export function StorageStatusBadge({ value }: { value: string }) {
  return <span className="storage-status" data-tone={storageHealthTone(value)}><span aria-hidden="true" className="storage-status__dot" />{storageHealthLabel(value)}</span>
}

export function StoragePageHeader({ healthy, disabled, onCreate }: { healthy: boolean; disabled: boolean; onCreate(): void }) {
  return <header className="storage-page__header"><div className="storage-page__identity"><span className="storage-page__mark" aria-hidden="true"><Database size={18} /></span><div><h2>Storage</h2><p>Manage ASH storage locations, groups, and connected Agent data.</p></div></div><div className="storage-page__commands"><StorageStatusBadge value={healthy ? 'healthy' : 'warning'} /><button className="storage-button storage-button--primary" disabled={disabled} onClick={onCreate}><Plus size={15} />Create volume</button></div></header>
}

export function StorageSection({ title, description, action, children }: { title: string; description?: string; action?: ReactNode; children: ReactNode }) {
  return <section className="storage-section" aria-labelledby={`storage-${title.toLowerCase().replaceAll(' ', '-')}`}><header className="storage-section__header"><div><h3 id={`storage-${title.toLowerCase().replaceAll(' ', '-')}`}>{title}</h3>{description && <p>{description}</p>}</div>{action}</header>{children}</section>
}

export function StorageSkeleton() {
  return <div className="storage-skeleton" aria-busy="true" aria-label="Loading storage status"><span /><span /><span /></div>
}
```

- [ ] **Step 4: Add the scoped design vocabulary**

Create `storage.css` with these concrete foundations, then add component-specific selectors in later tasks:

```css
.storage-page { height: 100%; overflow: auto; padding: 24px 28px 40px; color: var(--color-text-primary); }
.storage-page__header, .storage-section__header, .storage-row, .storage-actions { display: flex; align-items: center; }
.storage-page__header { justify-content: space-between; gap: 24px; padding-bottom: 24px; border-bottom: 1px solid var(--color-border); }
.storage-page__identity { display: flex; align-items: flex-start; gap: 12px; min-width: 0; }
.storage-page__identity h2, .storage-section__header h3 { margin: 0; color: var(--color-text-primary); text-wrap: balance; }
.storage-page__identity h2 { font-size: 20px; line-height: 1.25; font-weight: 650; letter-spacing: -0.01em; }
.storage-page__identity p, .storage-section__header p { margin: 4px 0 0; color: var(--color-text-secondary); font-size: 13px; line-height: 1.5; text-wrap: pretty; }
.storage-page__mark { display: grid; place-items: center; width: 34px; height: 34px; border-radius: var(--radius-md); color: var(--color-accent); background: var(--color-accent-subtle); }
.storage-page__commands, .storage-actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.storage-section { margin-top: 28px; }
.storage-section__header { justify-content: space-between; gap: 16px; margin-bottom: 12px; }
.storage-section__header h3 { font-size: 15px; line-height: 1.35; font-weight: 650; }
.storage-button { min-height: 36px; display: inline-flex; align-items: center; justify-content: center; gap: 7px; padding: 7px 12px; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-surface); color: var(--color-text-primary); font: 600 13px/1 var(--font-sans); cursor: pointer; transition: background var(--duration-fast) var(--ease-out-quart), border-color var(--duration-fast) var(--ease-out-quart), color var(--duration-fast) var(--ease-out-quart); }
.storage-button:hover:not(:disabled) { border-color: color-mix(in oklch, var(--color-accent) 42%, var(--color-border)); background: var(--color-accent-subtle); }
.storage-button--primary { border-color: var(--color-accent); background: var(--color-accent); color: var(--color-text-inverse); }
.storage-button--primary:hover:not(:disabled) { border-color: var(--color-accent-hover); background: var(--color-accent-hover); color: var(--color-text-inverse); }
.storage-button:disabled, .storage-control:disabled { cursor: not-allowed; opacity: .5; }
.storage-status { display: inline-flex; align-items: center; gap: 6px; width: max-content; color: var(--color-text-secondary); font-size: 12px; font-weight: 600; }
.storage-status__dot { width: 6px; height: 6px; border-radius: 50%; background: var(--color-text-muted); }
.storage-status[data-tone='healthy'] .storage-status__dot { background: var(--color-status-done); }
.storage-status[data-tone='warning'] .storage-status__dot { background: var(--color-status-pending); }
.storage-status[data-tone='danger'] .storage-status__dot { background: var(--color-status-failed); }
.storage-skeleton { display: grid; gap: 12px; }
.storage-skeleton span { display: block; height: 74px; border-radius: var(--radius-lg); background: color-mix(in oklch, var(--color-border-subtle) 76%, var(--color-surface)); animation: storage-skeleton 1.4s var(--ease-in-out-quart) infinite alternate; }
@keyframes storage-skeleton { to { opacity: .55; } }
@media (max-width: 680px) { .storage-page { padding: 20px 16px 32px; } .storage-page__header { align-items: flex-start; } .storage-page__commands { flex-direction: column; align-items: flex-end; } }
@media (prefers-reduced-motion: reduce) { .storage-page *, .storage-page *::before, .storage-page *::after { scroll-behavior: auto !important; animation-duration: 1ms !important; animation-iteration-count: 1 !important; transition-duration: 1ms !important; } }
```

- [ ] **Step 5: Run the focused test and typecheck**

```bash
pnpm --filter @manta/frontend exec vitest run src/features/storage/StorageSettingsPanel.test.tsx
pnpm --filter @manta/frontend typecheck
```

Expected: all focused tests pass and TypeScript exits 0.

---

### Task 3: Volume Panel and Progressive Git Configuration

**Files:**
- Modify: `packages/frontend/src/features/storage/StorageVolumeCard.tsx`
- Modify: `packages/frontend/src/features/storage/storage.css`
- Modify: `packages/frontend/src/features/storage/StorageSettingsPanel.test.tsx`

**Interfaces:**
- Consumes: existing `StorageVolumeCard` props unchanged
- Consumes: `formatStorageBytes`, `formatFileCount`, `StorageStatusBadge`
- Produces: same `StorageVolumeCard` export and callback behavior

- [ ] **Step 1: Change presentation tests to require formatted data and progressive disclosure**

```tsx
it('renders a compact Manta volume panel with readable facts and progressive Git controls', () => {
  const html = renderToStaticMarkup(<StorageVolumeCard volume={{ id: 'volume-1', name: 'Default', parentPath: '/Users/example/Documents', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }} bytes={4_796_804} files={255} disabled={false} onOpen={() => {}} onRelocate={() => {}} git={{ available: true }} onConfigureGit={() => {}} />)
  expect(html).toContain('4.6 MB')
  expect(html).toContain('255 files')
  expect(html).toContain('/Users/example/Documents/manta-ai-data')
  expect(html).toContain('<details')
  expect(html).toContain('Git sync')
  expect(html).toContain('storage-volume')
})
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run the focused command from Task 2. Expected: FAIL on `4.6 MB`, `<details`, and Storage classes.

- [ ] **Step 3: Restructure the volume article without changing callbacks**

Use this outer structure and keep every Git branch inside the `<details>` body:

```tsx
return <article aria-label={`${volume.name} volume`} className="storage-volume">
  <header className="storage-volume__header">
    <div className="storage-volume__identity">
      <div className="storage-volume__title"><strong>{volume.name}</strong><StorageStatusBadge value={health?.status ?? 'healthy'} /></div>
      <code title={`${volume.parentPath}/${ASH_VOLUME_DIR_NAME}`} className="storage-volume__path">{volume.parentPath}/{ASH_VOLUME_DIR_NAME}</code>
    </div>
    <div className="storage-actions"><button className="storage-button" disabled={disabled} onClick={onOpen}>Open folder</button><button className="storage-button" disabled={disabled} onClick={onRelocate}>Migrate</button></div>
  </header>
  <div className="storage-volume__facts">
    <span><b>{formatStorageBytes(bytes)}</b><small>Stored</small></span>
    <span><b>{formatFileCount(files).replace(' files', '')}</b><small>Files</small></span>
    <span><b>{formatStorageBytes(capacity?.logicalImmutableBytes)}</b><small>Logical immutable</small></span>
    <span><b>{formatStorageBytes(capacity?.physicalImmutableBytes)}</b><small>Physical immutable</small></span>
  </div>
  {health && health.status !== 'healthy' && <div role="alert" className="storage-alert storage-alert--danger">Automatic sync paused: this folder is {health.status}.{health.reason ? ` ${health.reason}` : ''}{health.conflicts.length ? ` Conflicts: ${health.conflicts.join(', ')}` : ''}</div>}
  <details className="storage-git">
    <summary><span>Git sync</span><span className="storage-git__state">{git?.binding ? git.binding.mode : git?.available ? 'Not configured' : 'Unavailable'}</span></summary>
    <div className="storage-git__body">
      {git?.binding?.remoteUrl && <code className="storage-git__remote">{git.binding.remoteUrl}</code>}
      {git?.binding?.lastSyncedAt && <p role="status">Last sync {git.binding.lastSyncStatus ?? 'succeeded'}: {new Date(git.binding.lastSyncedAt).toLocaleString()}</p>}
      {git?.binding && <p role="status">This volume is already bound to {git.binding.mode} Git. To use a different repository, create another storage volume.</p>}
      {git?.binding && onSetGitSecretsPolicy && <fieldset className="storage-fieldset"><legend>High-risk data</legend><label className="storage-checkbox"><input type="checkbox" checked={git.binding.includeSecrets === true} disabled={disabled || gitLoading} onChange={(event) => void setSecretsPolicy(event.target.checked)} /><span>Sync secrets to Git</span></label><p role="note">Git history is hard to erase. A private repository is not absolute safety. Turning this off removes secrets from the next snapshot, but does not erase existing Git history.</p></fieldset>}
      <div className="storage-actions">
        {git?.binding && onSync && <button className="storage-button" disabled={disabled || gitLoading} onClick={() => { setGitLoading(true); setGitError(undefined); void Promise.resolve(onSync()).catch((error) => setGitError((error as Error).message)).finally(() => setGitLoading(false)) }}>Sync now</button>}
        {git?.binding?.mode === 'remote' && onPlanImport && <button className="storage-button" disabled={disabled || gitLoading} onClick={() => { setGitLoading(true); setGitError(undefined); void onPlanImport().then((plan) => { setImportPlan(plan); setImportChoices(Object.fromEntries(plan.groups.map((group) => [group.group, group.defaultChoice]))) }).catch((error) => setGitError((error as Error).message)).finally(() => setGitLoading(false)) }}>Check remote updates</button>}
      </div>
      {importPlan && <section aria-label={`${volume.name} remote import plan`} className="storage-import"><strong>Remote changes</strong>{importPlan.groups.map((group) => <label key={group.group}>{group.group}: {group.state}<select className="storage-control" aria-label={`${group.group} import choice`} value={importChoices[group.group] ?? group.defaultChoice} onChange={(event) => setImportChoices((choices) => ({ ...choices, [group.group]: event.target.value }))}>{group.choices.map((choice) => <option key={choice} value={choice}>{choice}</option>)}</select></label>)}<p role="status">Remote data stays in an isolated cache until you apply these choices. Database groups are never merged.</p>{onApplyImport && <button className="storage-button storage-button--primary" disabled={disabled || gitLoading} onClick={() => { setGitLoading(true); setGitError(undefined); void onApplyImport(importPlan, importChoices as ImportDecisions).then(() => setImportPlan(undefined)).catch((error) => setGitError((error as Error).message)).finally(() => setGitLoading(false)) }}>Apply selected remote changes</button>}</section>}
      {git?.reason && <p className="storage-alert" role="status">{git.reason}</p>}
      {git?.available && onConfigureGit && <div className="storage-git__configure"><button className="storage-button" disabled={disabled || gitLoading} onClick={() => void configure('local')}>Configure local Git</button><label><span>Remote URL</span><div className="storage-inline-field"><input className="storage-control" aria-label={`${volume.name} Git remote URL`} value={remoteUrl} onChange={(event) => setRemoteUrl(event.target.value)} placeholder="https://host/owner/repository.git" /><button className="storage-button" disabled={disabled || gitLoading} onClick={() => void configure('remote')}>Configure remote Git</button></div></label></div>}
      {git?.available && <p role="status">Credential references are not supported in this build. For authenticated remotes, configure your system Git credential helper.</p>}
      {gitLoading && <p role="status">Configuring Git…</p>}
      {gitError && <p className="storage-alert storage-alert--danger" role="alert">{gitError}</p>}
    </div>
  </details>
</article>
```

- [ ] **Step 4: Add volume, facts, form, alert, and Git styles**

Add `.storage-volume`, `.storage-volume__header`, `.storage-volume__path`, `.storage-volume__facts`, `.storage-control`, `.storage-alert`, `.storage-git`, `.storage-git__body`, and responsive selectors. Use flat `--color-surface`, 1px `--color-border-subtle`, `--radius-lg`, and a facts grid of `repeat(auto-fit, minmax(112px, 1fr))`. Inputs and selects must be 36px high with focus-visible inherited from the global theme.

- [ ] **Step 5: Run Storage presentation tests and typecheck**

```bash
pnpm --filter @manta/frontend exec vitest run src/features/storage/StorageSettingsPanel.test.tsx
pnpm --filter @manta/frontend typecheck
```

Expected: all tests pass and no prop/callback type changes occur.

---

### Task 4: Capacity Summary and Seven-Group Inventory

**Files:**
- Modify: `packages/frontend/src/features/storage/StorageOverview.tsx`
- Modify: `packages/frontend/src/features/storage/StorageGroupRow.tsx`
- Modify: `packages/frontend/src/features/storage/storage.css`
- Modify: `packages/frontend/src/features/storage/StorageSettingsPanel.test.tsx`

**Interfaces:**
- Keeps existing `StorageOverview` and `StorageGroupRow` props
- Consumes formatting and status helpers

- [ ] **Step 1: Add failing single-volume prerequisite and formatted-capacity tests**

```tsx
it('explains the single-volume move prerequisite instead of showing a broken selector', () => {
  const html = renderToStaticMarkup(<StorageGroupRow group={{ id: 'knowledge', volumeId: 'volume-1', path: '/private/manta-ai-data/knowledge', bytes: 2_621_440, files: 1243, health: 'healthy' }} volumes={[{ id: 'volume-1', name: 'Default', parentPath: '/private', createdAt: '', updatedAt: '' }]} onMove={() => {}} disabled={false} />)
  expect(html).toContain('2.5 MB')
  expect(html).toContain('1,243 files')
  expect(html).toContain('Create another volume to move this group.')
  expect(html).toContain('disabled=""')
})

it('renders another volume as a valid move target', () => {
  const html = renderToStaticMarkup(<StorageGroupRow group={{ id: 'knowledge', volumeId: 'volume-1', path: '', bytes: 0, files: 0, health: 'healthy' }} volumes={[{ id: 'volume-1', name: 'Default', parentPath: '/one', createdAt: '', updatedAt: '' }, { id: 'volume-2', name: 'Archive', parentPath: '/two', createdAt: '', updatedAt: '' }]} onMove={() => {}} disabled={false} />)
  expect(html).toContain('Archive')
  expect(html).not.toContain('Create another volume to move this group.')
})
```

- [ ] **Step 2: Run focused tests and confirm RED**

Expected failures: raw file count and missing prerequisite copy.

- [ ] **Step 3: Build the compact capacity strip and inventory row**

`StorageOverview` must render a `.storage-capacity` summary followed by `.storage-groups`. `StorageGroupRow` must render `.storage-group` with identity, formatted metadata, status badge, current volume label, and a labeled select. Preserve the current option filtering and `onMove(group.id, event.target.value)` call.

Use this prerequisite branch:

```tsx
const canMove = volumes.length > 1
return <article className="storage-group" aria-label={`${label} storage group`}>
  <div className="storage-group__identity"><strong>{label}</strong><p>{description}</p></div>
  <div className="storage-group__meta"><span>{formatStorageBytes(group.bytes)}</span><span>{formatFileCount(group.files)}</span><StorageStatusBadge value={group.health} /></div>
  <div className="storage-group__target"><span className="storage-group__volume">{volumes.find((volume) => volume.id === group.volumeId)?.name ?? 'Unassigned'}</span><label><span className="sr-only">Move {label} group</span><select className="storage-control" aria-label={`Move ${label} group`} disabled={disabled || !canMove} value={group.volumeId} onChange={(event) => onMove(group.id, event.target.value)}><option value={group.volumeId}>Current volume</option>{volumes.filter((volume) => volume.id !== group.volumeId).map((volume) => <option key={volume.id} value={volume.id}>{volume.name}</option>)}</select></label>{!canMove && <small>Create another volume to move this group.</small>}</div>
</article>
```

- [ ] **Step 4: Add responsive inventory styles**

Desktop rows use `grid-template-columns: minmax(180px, 1.3fr) minmax(190px, .9fr) minmax(180px, .8fr)`. At `max-width: 760px`, use one column and align the select to the left. Apply only subtle row separators, not a card per group.

- [ ] **Step 5: Run focused tests and typecheck**

Use the same commands as Task 3. Expected: all Storage presentation tests pass.

---

### Task 5: Compose the Page, Agent Section, Backups, and Dialog

**Files:**
- Modify: `packages/frontend/src/features/storage/StorageSettingsPanel.tsx`
- Modify: `packages/frontend/src/features/storage/AgentConnectionsSection.tsx`
- Modify: `packages/frontend/src/features/storage/StorageOperationDialog.tsx`
- Modify: `packages/frontend/src/features/storage/storage.css`
- Modify: `packages/frontend/src/features/storage/StorageSettingsPanel.test.tsx`
- Modify: `packages/frontend/src/features/storage/AgentConnectionsSection.test.tsx`

**Interfaces:**
- Keeps all existing APIs, bridge requests, operation subscription, submission gate, and callbacks
- Imports `./storage.css` exactly once from `StorageSettingsPanel.tsx`

- [ ] **Step 1: Add failing hierarchy, empty, progress, and Agent visual-vocabulary assertions**

```tsx
it('keeps page sections in command order and imports the Storage design layer', () => {
  const source = readFileSync(new URL('./StorageSettingsPanel.tsx', import.meta.url), 'utf8')
  expect(source).toContain("import './storage.css'")
  const header = source.indexOf('<StoragePageHeader')
  const volumes = source.indexOf('title="Volumes"')
  const groups = source.indexOf('title="Storage groups"')
  const agents = source.indexOf('<AgentConnectionsSection')
  const backups = source.indexOf('title="Automatic backups"')
  expect(header).toBeGreaterThan(-1)
  expect(header).toBeLessThan(volumes)
  expect(volumes).toBeLessThan(groups)
  expect(groups).toBeLessThan(agents)
  expect(agents).toBeLessThan(backups)
  expect(source).toContain('Verified inactive backups appear here after a migration.')
})
```

Add to `AgentConnectionsSection.test.tsx`:

```tsx
expect(html).toContain('storage-agent')
expect(html).toContain('storage-button')
expect(html).toContain('storage-status')
```

- [ ] **Step 2: Run both presentation suites and confirm RED**

```bash
pnpm --filter @manta/frontend exec vitest run src/features/storage/StorageSettingsPanel.test.tsx src/features/storage/AgentConnectionsSection.test.tsx
```

Expected: FAIL on missing CSS import, primitives, order, and classes.

- [ ] **Step 3: Compose the page without changing orchestration**

Replace only the final presentation branch of `StorageSettingsPanel` with this structure:

```tsx
return <main className="storage-page" aria-label="Storage settings">
  <StoragePageHeader healthy={!error && overview.groups.every((group) => group.health === 'healthy')} disabled={busy} onCreate={createVolume} />
  {operation.operation && <div className="storage-operation" role="status"><span>{operation.operation.phase}</span><strong>{operation.operation.progress?.message ?? 'Operation in progress'}</strong></div>}
  {operation.error && <div className="storage-alert storage-alert--danger" role="alert">{operation.error.message}</div>}
  {loading ? <StorageSkeleton /> : error ? <div className="storage-alert storage-alert--danger" role="alert"><span>{error.message}</span><button className="storage-button" onClick={() => void refresh()}>Retry</button></div> : <>
    <StorageSection title="Volumes" description="Physical locations managed by ASH."><div className="storage-volumes">{volumes.map((volume) => <StorageVolumeCard key={volume.id} volume={volume} bytes={volume.inventory?.bytes} files={volume.inventory?.files} capacity={volume.capacity ?? overview.volumeCapacity?.find((item) => item.volumeId === volume.id)} disabled={busy} git={{ ...gitCapability, binding: gitBindings.find((binding) => binding.volumeId === volume.id) }} health={overview.volumeHealth?.[volume.id]} onConfigureGit={configureGit} onRequestGitSecretsGrant={() => requestGitSecretsGrant(volume.id)} onSetGitSecretsPolicy={(include, grant) => setGitSecretsPolicy(volume.id, include, grant)} onSync={() => syncGit(volume.id)} onPlanImport={() => planGitImport(volume.id)} onApplyImport={(plan, decisions) => applyGitImport(volume.id, plan, decisions)} onOpen={() => void run({ channel: 'storage:open-volume', volumeId: volume.id })} onRelocate={() => migrateVolume(volume)} />)}</div></StorageSection>
    <StorageSection title="Storage groups" description="Seven portable data domains routed across your volumes."><StorageOverview overview={overview} onMove={moveGroup} disabled={busy} /></StorageSection>
    <AgentConnectionsSection />
    <StorageSection title="Automatic backups" description="Verified inactive copies retained after storage changes.">{backups.length === 0 ? <div className="storage-empty"><strong>No automatic backups</strong><p>Verified inactive backups appear here after a migration.</p></div> : <ul className="storage-backups">{backups.map((backup) => <li key={backup.id}><div><strong>{backup.id}</strong><code>{backup.path}</code><span>{formatStorageBytes(backup.bytes)}</span></div><button className="storage-button storage-button--danger" disabled={busy} onClick={() => setDialog({ title: 'Delete backup', body: 'This permanently removes only the verified inactive backup. Active storage can never be selected.', action: () => run({ channel: 'storage:delete-backup', backupId: backup.id }) })}>Delete</button></li>)}</ul>}</StorageSection>
  </>}
  <StorageOperationDialog open={!!dialog} title={dialog?.title ?? ''} body={dialog?.body ?? ''} confirmLabel="Confirm and continue" busy={busy} onCancel={() => setDialog(undefined)} onConfirm={async () => { const current = dialog; if (!current) return; try { await submission.run(current.action); setDialog(undefined) } catch (reason) { setError(reason as Error) } }} />
</main>
```

- [ ] **Step 4: Apply the Storage vocabulary to Agent connections**

Keep all data branches and callbacks. Replace raw article/fieldset/table/button presentation with `.storage-agent`, `.storage-agent__header`, `.storage-agent__assets`, `.storage-control`, `.storage-button`, `.storage-alert`, and `.storage-table` classes. Wrap the section with `StorageSection title="Agent connections"` and render `StorageStatusBadge` for adapter state, progress, result, and error status. Do not hide any currently reachable action.

- [ ] **Step 5: Restyle and harden the confirmation dialog**

Keep the portal and duplicate-submit ref. Replace inline decoration with `.storage-dialog-backdrop`, `.storage-dialog`, `.storage-dialog__icon`, and `.storage-dialog__actions`. Add Escape handling while open and `autoFocus` to the confirm button. The confirm label remains `Working…` during `busy || submitting`; backdrop cancellation remains disabled while busy.

- [ ] **Step 6: Complete scoped responsive and state styles**

Add styles for page operation bar, empty states, backup list, Agent assets/table, dialog, danger buttons, and narrow layouts. Use a semantic z-index ladder in `storage.css` (`--storage-z-backdrop: 40; --storage-z-dialog: 41`) rather than `9999/10000`, because the values are scoped inside the existing Settings portal context.

- [ ] **Step 7: Run both presentation suites and typecheck**

```bash
pnpm --filter @manta/frontend exec vitest run src/features/storage/StorageSettingsPanel.test.tsx src/features/storage/AgentConnectionsSection.test.tsx
pnpm --filter @manta/frontend typecheck
```

Expected: both suites pass, all existing Storage callbacks remain type-compatible, and no TypeScript errors occur.

---

### Task 6: Full Verification and Visual Acceptance

**Files:**
- Review all files listed in the File Map
- Do not modify unrelated dirty worktree files

**Interfaces:**
- Verifies the complete UI redesign and existing Storage behavior boundary

- [ ] **Step 1: Run the complete frontend test suite**

```bash
pnpm --filter @manta/frontend test
```

Expected: all frontend test files and test cases pass.

- [ ] **Step 2: Run typecheck and production build**

```bash
pnpm --filter @manta/frontend typecheck
pnpm --filter @manta/frontend build
```

Expected: both commands exit 0. A pre-existing Vite chunk-size warning is acceptable; new build errors are not.

- [ ] **Step 3: Run the Storage desktop boundary tests**

```bash
pnpm --filter @manta/desktop exec vitest run src/ipc/registerStorageIpc.test.ts src/lifecycle/createStorageVolume.test.ts
```

Expected: all IPC and real temporary-filesystem volume tests pass.

- [ ] **Step 4: Render and inspect the page in light and dark themes**

Start the existing Desktop development app with:

```bash
pnpm dev:desktop
```

Inspect Storage at the default modal width and a narrow window. Capture light and dark screenshots. Verify no overlap, horizontal overflow, clipped dropdown, raw unstyled primary control, inaccessible disabled prerequisite, or hidden current operation. Verify Create volume, Open folder, Migrate, Git disclosure, group target selection, Agent actions, and backup deletion remain reachable.

- [ ] **Step 5: Run detector and final diff checks**

```bash
node "${CODEX_HOME:-$HOME/.codex}/skills/impeccable/scripts/detect.mjs" --json packages/frontend/src/features/storage
git diff --check
git diff -- packages/frontend/src/features/storage docs/superpowers/specs/2026-07-16-storage-command-center-design.md docs/superpowers/plans/2026-07-16-storage-command-center.md
```

Expected: no new high-priority design-rule violations, no whitespace errors, and no unrelated changes in the scoped diff.

- [ ] **Step 6: Compare against the acceptance checklist**

Confirm each design-spec acceptance item with a direct test result or screenshot observation. If any item lacks evidence, keep the goal active and fix or test it before requesting user feedback.
