# Storage Command Center UI Design

**Date:** 2026-07-16
**Status:** Approved
**Scope:** The Storage page inside the existing Settings modal

## Goal

Rebuild the Storage page as a precise, compact Manta control surface. Preserve every existing ASH capability while replacing the current raw browser controls, unformatted data, weak hierarchy, and long undifferentiated content stream.

The result must follow Manta's “Task Commander” design language:

- Warm Stone / Deep Abyss tinted neutral surfaces
- Emerald as the only primary action and selection accent
- Flat hierarchy expressed with spacing, borders, and surface tones instead of decorative shadows
- Dense but legible operational information
- Monospace only for paths and exact data
- Complete light/dark, keyboard, focus, and reduced-motion behavior

## Scope Boundaries

### Included

- Storage page information architecture and layout
- Volumes, capacity, storage groups, Git configuration, Agent connections, backups, loading, error, operation progress, and confirmation UI
- Shared Storage-only presentation primitives and CSS
- Responsive behavior inside the Settings modal
- Formatting of byte counts, file counts, paths, health, and operation labels
- UI-focused regression tests

### Excluded

- Settings modal navigation and theme switcher redesign
- Theme, general settings, or AI model tab redesign
- Storage API, IPC protocol, filesystem behavior, and migration semantics
- New storage or Git capabilities

## Page Structure

The page is a single scroll container with five operational regions.

### 1. Command Header

The header contains:

- `Storage` title
- Short ASH description, limited to one readable line where space allows
- Aggregate health indicator
- Emerald `Create volume` primary action

The primary action stays visible in the page header instead of appearing as an unstyled line between sections.

### 2. Volumes

Volumes are rendered as flat operational panels. Each panel contains:

- Name and health status
- Full resolved `manta-ai-data` path in monospace
- Human-readable total size and file count
- Compact capacity facts: logical immutable, physical immutable, replica/cache, and safely cleanable
- `Open` and `Migrate` secondary actions
- One-line Git status summary with an explicit expand/collapse control

Git configuration is progressive disclosure. It is collapsed by default and expands inline. Existing local, remote, secrets, sync, remote-import, and conflict-resolution capabilities remain available. Git controls use the same field, button, status, and alert vocabulary as the rest of the page.

### 3. Storage Groups

The seven ASH groups form a dense inventory list rather than seven oversized cards. Each row includes:

- Group name and short description
- Formatted size and file count
- Health status
- Current volume
- Move control

When only one volume exists, the move control is disabled and accompanied by the explanation `Create another volume to move this group.` This must read as an unavailable prerequisite, not as a broken control.

Aggregate capacity is presented in a compact summary strip above the rows. It does not use a hero-metric card pattern.

### 4. Agent Connections

Agent connections remain a separate operational section below storage groups. The default view shows adapter identity and connection state. Asset inventories, previews, and operation details expand only when available or requested.

Existing import, projection, rollback, retry, progress, secrets warning, and evidence information remains intact.

### 5. Automatic Backups

Backups are listed as a compact final section. Empty state copy explains that verified inactive backups appear after migrations. Delete remains a deliberate secondary/destructive action and continues to use confirmation.

## Component Model

The implementation will use focused Storage presentation components:

- `StorageSettingsPanel`: data orchestration and page composition
- `StoragePageHeader`: title, health, and create action
- `StorageVolumeCard`: volume facts and actions
- `StorageGitPanel`: progressive Git configuration and sync controls
- `StorageCapacitySummary`: compact verified-capacity facts
- `StorageGroupRow`: one group inventory and move control
- `StorageSection`: consistent section heading, description, and optional action
- `StorageOperationDialog`: Manta-styled confirmation and busy feedback
- `AgentConnectionsView`: existing Agent workflow presented with the Storage component vocabulary

Components communicate through their existing typed props and callbacks. The redesign does not introduce a second state store or duplicate API calls.

## Visual Rules

- Use existing CSS variables from `index.css`; do not introduce hardcoded purple or blue decorative accents.
- Main content background is `--color-background`; operational surfaces use `--color-surface` and `--color-surface-elevated`.
- Borders use `--color-border` / `--color-border-subtle`; elevation is flat by default.
- Cards and panels use at most `--radius-lg`.
- Primary action uses `--color-accent`; secondary actions are neutral ghost or bordered controls.
- Status colors are reserved for actual health or operation state.
- Paths and exact identifiers use `--font-mono`; readable storage sizes use normal UI type.
- Section gaps use 24–32px; related controls use 4–12px gaps.
- Transitions use `--duration-fast` or `--duration-normal` with `--ease-out-quart`.
- No nested decorative cards, gradient text, glassmorphism, glow, or wide soft shadows.

## Responsive Behavior

- The page fits the existing Settings modal without horizontal scrolling.
- Volume facts use responsive columns and collapse to one column at narrow widths.
- Long paths wrap or truncate with a discoverable full value; they never push actions outside the panel.
- Group rows collapse from data/action columns into stacked content while preserving label association.
- Buttons remain at least 36px high and do not overlap text.

## Interaction States

Every interactive control includes default, hover, focus-visible, active, disabled, and busy behavior.

- Loading: section-shaped skeletons preserve layout; no isolated center spinner.
- Empty: teach the next action, especially for volumes, backups, and Agent adapters.
- Error: inline alert with retry where recovery exists.
- Busy: disable conflicting operations and show the current operation phase/progress.
- Confirmation: fixed portal, focusable dialog, clear cancel/confirm hierarchy, duplicate-submit protection.
- Reduced motion: transitions become effectively instant under `prefers-reduced-motion: reduce`.

## Data and Behavior Preservation

The existing flow remains authoritative:

1. `StorageSettingsPanel` loads overview, volumes, backups, Git capability/bindings, and Agent state through existing APIs.
2. User actions invoke the existing desktop bridge channels.
3. Long-running operations continue through `useStorageOperation` and progress subscriptions.
4. Successful operations refresh current data.
5. Failures remain visible and recoverable without silently dismissing the relevant UI.

No ASH filesystem or migration logic changes are part of this redesign.

## Testing and Acceptance

Automated checks must cover:

- Page hierarchy and primary action placement
- Human-readable byte formatting
- Volume path and health presentation
- Single-volume move prerequisite copy and disabled state
- Multi-volume move target behavior
- Git collapsed and expanded states
- Operation dialog accessibility and duplicate-submit protection
- Loading, empty, busy, and error states
- Frontend tests, typecheck, and production build

Visual acceptance must verify the rendered Storage page in both light and dark themes at desktop and narrow modal widths. The page is accepted only if:

- No raw unstyled browser control dominates the interface
- No text or control overlaps, clips, or escapes its section
- The information hierarchy is understandable without scrolling through all details
- Primary and secondary actions are visually unambiguous
- All current Storage, Git, Agent, and backup operations remain reachable
- The result visibly matches Manta's precise, parallel, commanding product language
