# Import Migration Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make multi-group staged imports durably crash-recoverable and remove the non-reentrant import lease deadlock without reopening the plan/apply TOCTOU window.

**Architecture:** Add an explicit `import` migration journal whose paths are derived from the validated bootstrap, operation id, and storage-group ids. The MigrationCoordinator exclusively owns the group lease, runs an injected hash preflight under that lease, journals before any rename, rolls every partial `committing` layout back to old, and only chooses new after every install is live; backups remain through reopen/validation and a durable `completed` marker. Desktop recovery treats imports as internal operations, not user volume/group migrations.

**Tech Stack:** TypeScript, Zod, Vitest, atomic Bootstrap JSON writes, same-filesystem directory rename, StorageLeaseManager.

## Global Constraints

- Do not modify `BootstrapStore`, `createStorageVolume`, Git branches, or secrets policy.
- Never persist or trust an arbitrary absolute import path; derive live/staging/backup paths from validated bootstrap volume roots, operation ids, and group ids.
- All behavior changes follow RED → GREEN with real filesystem acceptance tests.

---

### Task 1: Journal schema and crash-boundary acceptance tests

**Files:**
- Modify: `packages/shared/src/storage.ts`
- Modify: `packages/storage-hub/src/migration/types.ts`
- Test: `packages/storage-hub/src/migration/migration-coordinator.test.ts`
- Test: `packages/desktop/src/lifecycle/DesktopLifecycleController.test.ts`

**Interfaces:**
- Produces: `MigrationJournal.kind: 'volume' | 'group' | 'import'` and import fault points `after-import-live-to-backup:<group>` / `after-import-staging-to-live:<group>`.
- Consumes: existing `AshBootstrap.pendingMigration` atomic persistence.

- [ ] Write table-driven two-group tests that inject a simulated process crash after each live→backup and staging→live rename, construct a fresh coordinator, run `recoverPending()` twice, and assert both groups contain either all old bytes or all new bytes with no mixed result.
- [ ] Add a test that observes the pending journal before the first rename and a test that proves it remains through every reopen/validate call.
- [ ] Add Desktop recovery coverage proving `kind: 'import'` is not recorded as a user volume/group migration or passed to backup-reference construction.
- [ ] Run `pnpm --filter @manta/storage-hub exec vitest run src/migration/migration-coordinator.test.ts` and the focused Desktop test; expect failures because import journaling/fault points do not exist.

### Task 2: Durable import state machine

**Files:**
- Modify: `packages/storage-hub/src/migration/migration-coordinator.ts`
- Modify: `packages/storage-hub/src/migration/types.ts`
- Modify: `packages/shared/src/storage.ts`
- Modify: `packages/desktop/src/desktop-runtime.ts`

**Interfaces:**
- Produces: `replaceGroupsFromStaging(groups, operationId?, preflight?)` where `preflight: () => Promise<void>` runs after exclusive lease acquisition and before quiesce/copy.
- Produces: idempotent import recovery derived as `live=<volumeRoot>/<group>`, `staging=<volumeRoot>/.ash-staging/<operationId>/<group>`, `backup=<volumeRoot>/.ash-backups/<operationId>/<group>`.

- [ ] Persist an `import` journal before the first quiesce/swap and transition through `copying`, `validating`, `committing`, `restarting`, `verifying`, and `completed` using atomic Bootstrap writes.
- [ ] During `committing`, recover every group to old: restore each present backup over any installed target, leave untouched targets whose backup was never created, and remove staged copies.
- [ ] After all staging→live renames, persist `restarting`; reopen and validate every target while all backups remain; on failure restore every old group; on success persist `completed`, remove backups, then clear the journal.
- [ ] Make every recovery step idempotent and fail closed on impossible/missing layouts.
- [ ] Update Desktop recovery to skip user migration bookkeeping for `import` journals.
- [ ] Run the focused migration and Desktop tests; expect all new and existing cases to pass.

### Task 3: Single lease owner and verification

**Files:**
- Modify: `packages/storage-hub/src/sync/import-coordinator.ts`
- Test: `packages/storage-hub/src/sync/import-coordinator.test.ts`
- Modify: `packages/backend/src/storage/runtime.ts`
- Test: `packages/backend/src/storage/runtime.test.ts`

**Interfaces:**
- ImportCoordinator delegates selected groups plus an expected-local-hash preflight; it no longer acquires `StorageLeaseManager` directly.
- Backend passes the preflight into `MigrationCoordinator.replaceGroupsFromStaging` unchanged.

- [ ] Write a real composition test with a short migration lease timeout that calls `ImportCoordinator.apply()` through the production replacement and fails RED by timing out on recursive acquisition.
- [ ] Change ImportCoordinator to construct a preflight closure and delegate it with the selected groups; change Backend runtime wiring to forward it.
- [ ] Assert a competing writer cannot enter while preflight and replacement run, and a changed expected local digest rejects before any live rename.
- [ ] Run focused Storage Hub and Backend tests, then `pnpm --filter @manta/storage-hub typecheck`, `pnpm --filter @manta/backend typecheck`, and `pnpm --filter @manta/desktop typecheck`.
- [ ] Review `git diff --check`, commit only the scoped files with a focused message, and report RED/GREEN evidence plus the commit SHA.
