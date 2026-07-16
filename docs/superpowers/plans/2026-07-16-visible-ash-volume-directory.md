# Visible ASH Volume Directory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every active ASH volume use the visible directory name `manta-ai-data` and atomically rename the existing local volume without data loss.

**Architecture:** `ASH_VOLUME_DIR_NAME` remains the single runtime source of truth. Storage Hub, Desktop initialization, Backend paths, and Frontend labels derive from it; tests and current documentation assert the same contract. The live directory is renamed only while Electron is stopped, followed by full ASH and real-runtime verification.

**Tech Stack:** TypeScript, Node.js filesystem APIs, Electron, React, Vitest, Turbo, pnpm.

## Global Constraints

- The exact active directory name is `manta-ai-data`.
- Do not introduce a second configurable runtime name or a symlink.
- Do not merge or overwrite directories if both `.manta-ai` and `manta-ai-data` exist.
- Preserve all seven ASH groups and the existing bootstrap schema.
- Preserve unrelated uncommitted changes; do not commit, push, or deploy.

---

### Task 1: Lock the visible directory contract with failing tests

**Files:**
- Modify: `packages/shared/src/constants.ts`
- Modify: `packages/storage-hub/src/domain/invariants.test.ts`
- Modify: `packages/storage-hub/src/router/path-router.test.ts`
- Modify: `packages/storage-hub/src/acceptance/storage-foundation.acceptance.test.ts`
- Modify: `packages/storage-hub/src/dual-format.test.ts`
- Modify: `packages/desktop/src/lifecycle/initializeStorage.test.ts`
- Modify: `packages/desktop/src/lifecycle/createStorageVolume.test.ts`
- Modify: `packages/backend/src/routes/storage.test.ts`
- Modify: `packages/frontend/src/features/storage/StorageSettingsPanel.test.tsx`

**Interfaces:**
- Produces: `ASH_VOLUME_DIR_NAME === 'manta-ai-data'` and `volumeRoot(parentPath)` returning `<parent>/manta-ai-data`.

- [ ] **Step 1: Change assertions, not production behavior**

Update the focused expectations to require `manta-ai-data`, including POSIX, Windows, group paths, initialization, volume creation, Backend overview paths, and rendered Storage text.

- [ ] **Step 2: Verify RED**

Run:

```bash
TMPDIR=/private/tmp pnpm --filter @manta/storage-hub exec vitest run src/domain/invariants.test.ts src/router/path-router.test.ts src/acceptance/storage-foundation.acceptance.test.ts src/dual-format.test.ts
TMPDIR=/private/tmp pnpm --filter @manta/desktop exec vitest run src/lifecycle/initializeStorage.test.ts src/lifecycle/createStorageVolume.test.ts
TMPDIR=/private/tmp pnpm --filter @manta/backend exec vitest run src/routes/storage.test.ts
TMPDIR=/private/tmp pnpm --filter @manta/frontend exec vitest run src/features/storage/StorageSettingsPanel.test.tsx
```

Expected: failures show actual `.manta-ai` paths where `manta-ai-data` is expected.

### Task 2: Make the configured name authoritative at runtime

**Files:**
- Modify: `packages/shared/src/constants.ts`
- Modify: `packages/desktop/src/lifecycle/initializeStorage.ts`
- Modify: `packages/backend/src/routes/storage.ts`
- Modify: `packages/frontend/src/features/storage/StorageVolumeCard.tsx`
- Modify: `packages/frontend/src/features/storage/StorageSettingsPanel.tsx`
- Modify: `packages/frontend/src/pages/settings/page.tsx`
- Modify: `packages/frontend/src/components/SettingsModal.tsx`
- Modify: `packages/desktop/src/onboarding/index.ts`
- Modify: `packages/desktop/src/onboarding/index.html`

**Interfaces:**
- Consumes: `ASH_VOLUME_DIR_NAME` from `@manta/shared`.
- Produces: runtime paths and visible labels that use `manta-ai-data`.

- [ ] **Step 1: Change the single source of truth**

```ts
export const DEFAULT_DATA_DIR_NAME = 'manta-ai-data'
export const ASH_VOLUME_DIR_NAME = DEFAULT_DATA_DIR_NAME
```

- [ ] **Step 2: Derive transaction names and probes**

In Desktop initialization, import `ASH_VOLUME_DIR_NAME` and define:

```ts
const STAGING_PREFIX = `${ASH_VOLUME_DIR_NAME}.initializing-`
const PROBE_PREFIX = `${ASH_VOLUME_DIR_NAME}-probe-`
const QUARANTINE_PREFIX = `${ASH_VOLUME_DIR_NAME}.quarantine-`
```

Use these constants at every initialization filesystem boundary.

- [ ] **Step 3: Derive Backend and Frontend display paths**

Import `ASH_VOLUME_DIR_NAME` and construct paths with `join` or the existing platform-aware `volumeRoot`; render `${volume.parentPath}/${ASH_VOLUME_DIR_NAME}` in the volume card and use the configured name in dialogs/settings copy.

- [ ] **Step 4: Verify GREEN**

Re-run all Task 1 commands. Expected: all focused suites pass.

### Task 3: Update migration, audit, documentation, and remaining contract fixtures

**Files:**
- Modify: tests returned by `rg -l '\.manta-ai' packages scripts`
- Modify: `scripts/security/fixtures/ash-storage-audit-cases.json`
- Modify: `scripts/verify/ash-phase1.ts`
- Modify: `README.md`
- Modify: `docs/guides/agent-storage-hub.md`
- Modify: `docs/troubleshooting/agent-storage-hub.md`
- Modify: `docs/development/agent-storage-hub.md`
- Modify: `docs/superpowers/verification/2026-07-11-agent-storage-hub.md`

**Interfaces:**
- Consumes: the configured `manta-ai-data` contract.
- Produces: acceptance, audit, and active documentation with no stale live-directory assumptions.

- [ ] **Step 1: Update active expectations and fixture paths**

Replace active `.manta-ai` volume roots with `manta-ai-data`. Keep `.ash`, `.ash-backups`, and `.ash-2pc` internal metadata names unchanged. Historical design/plan documents remain historical except the current recovery plan, which is updated to describe the current result.

- [ ] **Step 2: Check for unsafe remaining production literals**

Run:

```bash
rg -n '\.manta-ai' packages --glob '!**/*.test.ts' --glob '!**/*.test.tsx' --glob '!**/dist/**' --glob '!**/.turbo/**'
```

Expected: no active runtime path or user-facing `.manta-ai` reference.

- [ ] **Step 3: Run the static persistence audit**

```bash
pnpm storage:audit
```

Expected: audit passes for every scanned production source file.

### Task 4: Atomically rename the live volume

**Files:**
- Rename on disk: `/Users/example/Documents/.manta-ai` to `/Users/example/Documents/manta-ai-data`

**Interfaces:**
- Consumes: existing volume manifest and bootstrap parent `/Users/example/Documents`.
- Produces: the same bytes and inode tree under the visible directory name.

- [ ] **Step 1: Stop the running Electron process gracefully**

Send Ctrl-C to the tracked Desktop development session and wait for the launcher to restore the Node ABI native module.

- [ ] **Step 2: Verify rename preconditions**

```bash
test -d /Users/example/Documents/.manta-ai
test ! -e /Users/example/Documents/manta-ai-data
```

Expected: both checks exit zero. If either fails, stop without mutation.

- [ ] **Step 3: Record identity and atomically rename**

Record the old directory device/inode and manifest hash, then use Node `fs.promises.rename(oldPath, newPath)` on the same parent filesystem. Verify the new directory retains the recorded identity and manifest hash and the old path is absent.

### Task 5: Full regression and real Desktop verification

**Files:**
- Inspect only: final git diff and runtime API output.

**Interfaces:**
- Consumes: renamed directory and rebuilt packages.
- Produces: evidence that ASH and Codex remain fully usable.

- [ ] **Step 1: Run ASH acceptance**

```bash
TMPDIR=/private/tmp VITEST_MAX_THREADS=4 VITEST_MIN_THREADS=1 pnpm verify:ash:phase1
TMPDIR=/private/tmp VITEST_MAX_THREADS=4 VITEST_MIN_THREADS=1 pnpm verify:ash:phase2
TMPDIR=/private/tmp VITEST_MAX_THREADS=4 VITEST_MIN_THREADS=1 pnpm verify:ash:phase3
TMPDIR=/private/tmp VITEST_MAX_THREADS=4 VITEST_MIN_THREADS=1 pnpm verify:ash:phase4
```

Expected: all four acceptance phases pass.

- [ ] **Step 2: Build and inspect**

```bash
pnpm build
git diff --check
```

Expected: seven package builds pass and the diff has no whitespace errors.

- [ ] **Step 3: Start Desktop and assert the real API**

Start `pnpm --filter @manta/desktop dev`, discover its loopback port, then assert:

```text
Codex adapter status = detected
volume inventory root = /Users/example/Documents/manta-ai-data
group count = 7
healthy group count = 7
```

- [ ] **Step 4: Review final scope**

Confirm `.turbo` build logs are not left modified, no secrets appear in the diff, unrelated user changes remain intact, and Electron remains running for the user.
