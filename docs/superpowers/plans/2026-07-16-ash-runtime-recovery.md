# ASH Runtime Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Desktop ASH runtime start reliably, expose the active storage location immediately, and make every Codex import/projection flow available on a normal Codex installation.

**Architecture:** Keep privileged ASH mutations in Electron IPC and the existing Backend composition. Repair the development/runtime entry boundary, safely prepare Codex's documented user-skill root before the read-only adapter detects it, and reorder the shared Storage panel so volume identity and paths precede detailed groups and Agent connections.

**Tech Stack:** Electron 41, Node.js 22, TypeScript, React 19, Fastify, Vitest, Node test runner, pnpm/Turbo.

## Global Constraints

- Preserve all existing user changes and do not reset unrelated files.
- Do not commit, push, create a PR, or deploy without explicit authorization.
- Use the official Codex personal skill location `$HOME/.agents/skills`; do not treat legacy `$CODEX_HOME/skills` as the current standard.
- Codex detection remains read-only and all native roots must reject symbolic links and overlapping roots.
- Every new production behavior requires a test observed failing for the intended reason before implementation.

---

### Task 1: Verify the Desktop Runtime Boundary

**Files:**
- Modify: `packages/backend/package.json`
- Create: `packages/backend/scripts/build-runtime.cjs`
- Create: `packages/backend/src/runtime-entry.test.ts`
- Modify: `packages/desktop/package.json`
- Modify: `packages/desktop/src/main.ts`
- Modify: `packages/desktop/src/baseline.test.ts`
- Create: `packages/desktop/scripts/run-dev.cjs`
- Create: `packages/desktop/scripts/run-dev.test.cjs`

**Interfaces:**
- Produces a loadable `@manta/backend` runtime entry for Electron.
- Produces `runDev()` that rebuilds `better-sqlite3` for Electron and restores the Node ABI on every exit path.

- [ ] Run the focused Desktop launcher and Backend runtime-entry tests.
- [ ] Build Frontend and Desktop, launch the actual Electron process, and confirm it owns a loopback Backend listener.
- [ ] Verify `/api/storage/overview` reads the initialized bootstrap and all seven routed groups.

### Task 2: Prepare the Official Codex User Skill Root Safely

**Files:**
- Modify: `packages/backend/src/storage/agent-storage.ts`
- Test: `packages/backend/src/storage/agent-storage.test.ts`

**Interfaces:**
- Produces `prepareCodexNativeRoots(homeDirectory, environment)` or an equivalent focused helper called before `CodexAdapter` construction.
- Leaves `detectCodex()` read-only and returns the documented `$HOME/.agents/skills` root.

- [ ] Add a test where `$HOME/.codex` exists and `$HOME/.agents/skills` is absent; expect composition creation to prepare the directory and report Codex as detected.
- [ ] Run the focused test and confirm it fails because detection currently requires the missing directory.
- [ ] Implement minimal ancestor-by-ancestor directory creation and ordinary-directory/no-symlink validation for `.agents/skills`.
- [ ] Add and run a linked-ancestor rejection test, then run all Backend agent-storage and Storage Hub Codex adapter tests.

### Task 3: Put the Active Volume and Path First

**Files:**
- Modify: `packages/frontend/src/features/storage/StorageSettingsPanel.tsx`
- Test: `packages/frontend/src/features/storage/StorageSettingsPanel.test.tsx`

**Interfaces:**
- The Storage panel renders `Volumes` and each `<parent>/manta-ai-data` path before group detail and Agent connections.
- Existing IPC callbacks and security confirmations remain unchanged.

- [ ] Add a render-order regression test proving the volume path appears before `Extensions` and `Agent connections`.
- [ ] Run the test and confirm the existing order fails.
- [ ] Move the existing volume-card block ahead of `StorageOverview`; keep Agent Connections below storage management.
- [ ] Run Frontend storage tests and typecheck.

### Task 4: Full ASH Verification

**Files:**
- Review only: all changed files and generated Diff.

**Interfaces:**
- No new interfaces.

- [ ] Run `pnpm storage:audit`.
- [ ] Run focused package tests and `pnpm typecheck`.
- [ ] Run `pnpm build`.
- [ ] Run `pnpm verify:ash:phase1`, `phase2`, `phase3`, and `phase4`.
- [ ] Run `pnpm --filter @manta/desktop test:e2e:ash` when supported on this host.
- [ ] Relaunch Electron and verify `/api/storage/agents` detects Codex, the asset endpoint is readable, and the active `manta-ai-data` path exists.
- [ ] Inspect the final Diff for unrelated changes, secrets, compatibility risks, and completion against the user goal.
