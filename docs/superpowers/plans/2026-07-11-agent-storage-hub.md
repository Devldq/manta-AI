# Agent Storage Hub Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the complete Manta ASH design: required first-run storage setup, volume/group routing and migration, per-volume Git sync, content deduplication and storage insights, and a Codex asset adapter.

**Architecture:** A new `@manta/storage-hub` package owns volume identity, group routing, leases, migration journals, inventory, Git snapshots, CAS, and adapter contracts. Electron owns privileged lifecycle and restart operations; Backend receives an initialized StorageHub and exposes read APIs; Frontend shares one Storage panel between settings surfaces. All application persistence is routed through one of seven groups while user-directed workspace output remains untouched.

**Tech Stack:** TypeScript 5, Node.js filesystem/crypto/child_process, Zod 4, Vitest 2, Fastify 5, Electron 41, React 19, better-sqlite3, Git CLI through `execFile`.

## Global Constraints

- The actual directory inside every selected parent is named exactly `.manta-ai`.
- Storage group IDs are exactly `extensions`, `knowledge`, `work`, `config`, `secrets`, `diagnostics`, and `cache`.
- Every group belongs to exactly one active volume; one volume may contain many groups and bind at most one Git repository.
- Skills, Plugins, and Plugin Marketplace are one indivisible `extensions` group.
- Original documents, RAG metadata, SQLite, Vector DB, and embeddings are one `knowledge` group.
- iCloud/OneDrive/Dropbox are folder locations; ASH does not emulate their network protocols.
- All successful location changes preserve a source backup and immediately relaunch the application.
- Internal persistence must not use `~/.manta-data`, runtime repository `.manta`, or browser-only durable state.
- User/Agent-selected workspace files and output paths are never redirected by ASH.
- No Agent Harness implementation is included.
- Production code follows test-first red-green-refactor. Each task records the failing command before implementation.
- Current baseline is not green: Backend typecheck has existing AI SDK/Skill/RAG errors and agent-sandbox has no tests. Task 1 makes the verification baseline meaningful before feature claims.

---

## Phase 1 — Storage Foundation and Safe Migration

### Task 1: Repair verification gates and establish test infrastructure

**Files:**
- Modify: `package.json`
- Modify: `turbo.json`
- Modify: `packages/backend/package.json`
- Modify: `packages/desktop/package.json`
- Modify: `packages/frontend/package.json`
- Modify: `packages/rag/package.json`
- Modify: `packages/agent-sandbox/package.json`
- Modify: `.husky/pre-commit`
- Modify: `.husky/commit-msg`
- Modify: `packages/backend/src/core/context/compaction/llm-compaction.ts`
- Modify: `packages/backend/src/core/engine/agent-loop.ts`
- Modify: `packages/backend/src/core/storage/skill/store.ts`
- Modify: `packages/backend/src/routes/rag.ts`
- Create: `packages/backend/src/baseline.test.ts`
- Create: `packages/rag/src/baseline.test.ts`
- Create: `packages/desktop/src/baseline.test.ts`
- Create: `packages/frontend/src/baseline.test.ts`
- Create: `packages/agent-sandbox/src/baseline.test.ts`

**Interfaces:**
- Produces root commands `pnpm test`, `pnpm typecheck`, and `pnpm build` that include all workspace packages relevant to ASH.
- Produces valid Husky paths to `scripts/security/sensitive-check.ts` and `scripts/release/update-version.ts`.

- [ ] **Step 1: Capture the known-red baseline**

Run: `pnpm typecheck`

Expected: FAIL with the existing LanguageModel, SkillSummary/SkillSource, and RAG implicit-any errors recorded in the implementation log.

Run: `pnpm --filter @manta/agent-sandbox test`

Expected: FAIL with `No test files found`.

- [ ] **Step 2: Add one executable smoke test per package and root test orchestration**

Each baseline test contains a real package assertion:

- Shared asserts `DEFAULT_LLM_CONFIG.MAX_STEPS === 200`.
- RAG asserts `inferMimeType('notes.md') === 'text/markdown'`.
- Agent Sandbox asserts a child path is accepted by `isPathInAllowedRoots`.
- Backend asserts `apiSuccess({ ok: true })` returns the canonical success envelope.
- Frontend asserts `getThemeById('cli-pixel')` resolves a configured theme.
- Desktop reads its package manifest and asserts the Electron main entry is `dist/main.js`.

Add `"test": "vitest run"` to each package, `"test": "pnpm exec turbo run test"` to root, and this Turbo task:

```json
"test": {
  "dependsOn": ["^build"],
  "outputs": ["coverage/**"]
}
```

- [ ] **Step 3: Resolve baseline type errors without changing behavior**

Use the actual AI SDK accepted model type at the call boundary, restore missing Skill types/properties from their authoritative definitions, and type RAG callback parameters explicitly. Do not use `any` or blanket casts to silence the compiler.

- [ ] **Step 4: Correct Husky script paths and verify all gates**

Run: `pnpm test`

Expected: PASS with at least one test in each listed package.

Run: `pnpm typecheck`

Expected: PASS.

Run: `pnpm build`

Expected: PASS and include Shared, Storage Hub once created, RAG, Agent Sandbox, Backend, Frontend, and Desktop by the end of Task 2.

- [ ] **Step 5: Commit**

```text
git commit -m "test: establish workspace verification gates"
```

### Task 2: Create shared ASH contracts and the dual-format Storage Hub package

**Files:**
- Create: `packages/shared/src/storage.ts`
- Modify: `packages/shared/src/index.ts`
- Modify: `packages/shared/src/constants.ts`
- Create: `packages/storage-hub/package.json`
- Create: `packages/storage-hub/tsconfig.json`
- Create: `packages/storage-hub/src/index.ts`
- Create: `packages/storage-hub/src/domain/types.ts`
- Create: `packages/storage-hub/src/domain/schemas.ts`
- Create: `packages/storage-hub/src/domain/errors.ts`
- Create: `packages/storage-hub/src/domain/invariants.ts`
- Create: `packages/storage-hub/src/domain/invariants.test.ts`
- Modify: `packages/backend/package.json`
- Modify: `packages/desktop/package.json`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Produces `STORAGE_GROUP_IDS`, `StorageGroupId`, volume/bootstrap/migration DTOs, `StorageOperationProgress`, and IPC request/response schemas.
- Produces `@manta/storage-hub` ESM and CJS exports so ESM Backend and CommonJS Electron can consume the same core.

- [ ] **Step 1: Write failing invariant tests**

```ts
it('rejects a group assigned to two volumes', () => {
  expect(() => validateBootstrap(bootstrapWithDuplicateAssignment())).toThrow('exactly one volume')
})

it('uses .manta-ai below the selected parent', () => {
  expect(volumeRoot('C:/Users/me')).toBe('C:\\Users\\me\\.manta-ai')
})
```

Run: `pnpm --filter @manta/storage-hub test`

Expected: FAIL because the package/domain functions do not exist.

- [ ] **Step 2: Implement exact group and volume contracts**

```ts
export const STORAGE_GROUP_IDS = [
  'extensions', 'knowledge', 'work', 'config', 'secrets', 'diagnostics', 'cache',
] as const
export type StorageGroupId = typeof STORAGE_GROUP_IDS[number]

export interface StorageVolumeRecord {
  id: string
  name: string
  parentPath: string
  createdAt: string
  updatedAt: string
}
```

Use Zod at JSON/IPC/API boundaries and TypeScript interfaces internally.

- [ ] **Step 3: Build dual ESM/CJS output and wire workspace dependencies**

Use `tsup` with `--format esm,cjs --dts --clean` and package exports for both `import` and `require`. Frontend imports only `@manta/shared`, never the Node package.

Run: `pnpm --filter @manta/storage-hub test && pnpm --filter @manta/storage-hub build`

Expected: PASS.

- [ ] **Step 4: Commit**

```text
git commit -m "feat(storage): add ASH domain contracts"
```

### Task 3: Implement atomic Bootstrap, manifests, registry, and path router

**Files:**
- Create: `packages/storage-hub/src/bootstrap/atomic-json.ts`
- Create: `packages/storage-hub/src/bootstrap/bootstrap-store.ts`
- Create: `packages/storage-hub/src/bootstrap/recovery.ts`
- Create: `packages/storage-hub/src/bootstrap/bootstrap-store.test.ts`
- Create: `packages/storage-hub/src/registry/volume-registry.ts`
- Create: `packages/storage-hub/src/registry/volume-registry.test.ts`
- Create: `packages/storage-hub/src/router/path-router.ts`
- Create: `packages/storage-hub/src/router/path-router.test.ts`
- Modify: `packages/storage-hub/src/index.ts`

**Interfaces:**
- Produces `BootstrapStore.read/write/update`, `recoverBootstrap`, `VolumeRegistry`, `StoragePathRouter.resolve(group, ...segments)`.

- [ ] **Step 1: Write failing tests for atomic recovery and path safety**

Cover missing bootstrap, invalid schema, higher-generation valid snapshot, interrupted `.tmp`, duplicate volume IDs, unassigned groups, `..`, absolute segments, case-insensitive nesting, and source/target containment.

Run: `pnpm --filter @manta/storage-hub test -- bootstrap-store path-router volume-registry`

Expected: FAIL because the modules are missing.

- [ ] **Step 2: Implement atomic JSON and deterministic recovery**

Atomic writes create a unique sibling temp file, flush it, rename it, and retain `previous` only through the Bootstrap schema. Recovery chooses by valid generation and journal phase, never mtime alone.

- [ ] **Step 3: Implement registry and router invariants**

```ts
resolve(group: StorageGroupId, ...segments: string[]): string {
  const volume = this.registry.volumeFor(group)
  return safeJoin(path.join(volume.parentPath, '.manta-ai', group), segments)
}
```

Reject absolute/path-traversal segments and nested volume roots.

- [ ] **Step 4: Verify**

Run: `pnpm --filter @manta/storage-hub test`

Expected: PASS.

- [ ] **Step 5: Commit**

```text
git commit -m "feat(storage): add bootstrap registry and routing"
```

### Task 4: Implement leases, inventory, migration transactions, and backup recovery

**Files:**
- Create: `packages/storage-hub/src/runtime/lease-manager.ts`
- Create: `packages/storage-hub/src/runtime/lease-manager.test.ts`
- Create: `packages/storage-hub/src/inventory/file-inventory.ts`
- Create: `packages/storage-hub/src/inventory/file-inventory.test.ts`
- Create: `packages/storage-hub/src/migration/types.ts`
- Create: `packages/storage-hub/src/migration/copy-tree.ts`
- Create: `packages/storage-hub/src/migration/migration-coordinator.ts`
- Create: `packages/storage-hub/src/migration/migration-coordinator.test.ts`
- Create: `packages/storage-hub/src/runtime/storage-hub.ts`
- Modify: `packages/storage-hub/src/index.ts`

**Interfaces:**
- Produces `StorageLeaseManager`, `inventoryTree`, `MigrationCoordinator.relocateVolume/moveGroup/recoverPending`, and `createStorageHub`.
- Consumes group drivers with `quiesce/checkpoint/close/validate/reopen/inventory`.

- [ ] **Step 1: Write fault-injection tests first**

Tests use real temporary directories and injected failures at `copying`, `validating`, immediately before Bootstrap commit, and after commit. Assert that pre-commit failures preserve source mapping, post-commit validation failures restore `previous`, target staging is isolated, and source backup remains.

Run: `pnpm --filter @manta/storage-hub test -- migration-coordinator`

Expected: FAIL because migration is absent.

- [ ] **Step 2: Implement fair read/write/exclusive leases and inventory**

Inventory records relative path, kind, byte size, SHA-256, and symlink target without following the link. Migration waits for active writes with a deadline and cancels safely on timeout.

- [ ] **Step 3: Implement volume relocation and group movement state machines**

Persist every phase, emit structured byte/file progress, require free bytes `>= sourceBytes * 1.10` with a minimum 256 MiB margin, validate before the Bootstrap commit, preserve source data, and support deterministic restart recovery.

- [ ] **Step 4: Verify**

Run: `pnpm --filter @manta/storage-hub test`

Expected: PASS including injected interruption cases.

- [ ] **Step 5: Commit**

```text
git commit -m "feat(storage): add transactional volume migration"
```

### Task 5: Add Backend StorageHub composition root and explicit server lifecycle

**Files:**
- Create: `packages/backend/src/storage/runtime.ts`
- Create: `packages/backend/src/storage/group-drivers.ts`
- Create: `packages/backend/src/storage/runtime.test.ts`
- Create: `packages/backend/src/app.ts`
- Modify: `packages/backend/src/server.ts`
- Modify: `packages/rag/src/types.ts`
- Modify: `packages/rag/src/sqlite-vec-provider.ts`
- Modify: `packages/rag/src/embedding-cache.ts`
- Modify: `packages/rag/src/index.ts`

**Interfaces:**
- Produces `startServer({storage, port?, host?}): Promise<MantaServerHandle>` with `port`, `quiesce`, `close`, and `healthCheck`.
- Produces resettable RAG factories and knowledge driver checkpoint/close/integrity validation.

- [ ] **Step 1: Write failing lifecycle tests**

Assert importing `server.ts` does not listen, `startServer` returns its actual dynamic port, `quiesce` rejects new writes, and `close` checkpoints/closes SQLite and timers.

- [ ] **Step 2: Refactor Fastify construction away from module side effects**

```ts
export async function startServer(options: StartServerOptions): Promise<MantaServerHandle> {
  const app = await buildApp(options)
  await app.listen({ port: options.port ?? 0, host: options.host ?? '127.0.0.1' })
  return createServerHandle(app, options.storage)
}
```

CLI/headless entry starts explicitly; Desktop imports without side effects.

- [ ] **Step 3: Add lifecycle to RAG and schedulers**

Remove homedir fallbacks and unresettable global instances. Add WAL checkpoint, `PRAGMA integrity_check`, close, reopen, and stop functions for Marketplace timer/log writers used by group drivers.

- [ ] **Step 4: Verify**

Run: `pnpm --filter @manta/backend test && pnpm --filter @manta/rag test`

Expected: PASS.

- [ ] **Step 5: Commit**

```text
git commit -m "refactor(server): expose managed storage lifecycle"
```

### Task 6: Route all Backend, RAG, Sandbox, and extension persistence through ASH

**Files:**
- Modify: all files listed in design section 9 and confirmed by `rg` audit, including `packages/backend/src/core/storage/**`, `core/llm/config-store.ts`, `core/engine/rag/embedding-config-store.ts`, `core/context/context-snapshot.ts`, `core/tools/mcp/config-store.ts`, `core/tools/mcp/oauth.ts`, `core/security/fs-access.ts`, `core/observability/log/file-writer.ts`, `core/engine/runner/process-registry.ts`, `core/tools/builtin/utils.ts`, `core/tools/builtin/bash.ts`, `routes/audit.ts`, `routes/rag.ts`, `routes/plugins.ts`, `plugins/loader.ts`, `packages/rag/src/**`, and `packages/agent-sandbox/src/audit/AuditLogger.ts`
- Create: `packages/backend/src/storage/path-routing.test.ts`
- Create: `scripts/security/ash-storage-audit.ts`
- Create: `scripts/security/ash-storage-allowlist.json`
- Modify: `package.json`

**Interfaces:**
- Consumes `getStorageHub().resolve(group, ...)` or an injected StorageHub/factory.
- Produces no runtime writes to `.manta-data`, repository `.manta`, `process.cwd()/.mcp-tokens`, or repository `skills/plugins`.

- [ ] **Step 1: Add a failing static audit and injected-path integration tests**

The audit reports forbidden literals and unapproved internal file writers while allowing explicit user file tools and build/release scripts.

Run: `pnpm storage:audit`

Expected: FAIL with the current hardcoded path inventory.

- [ ] **Step 2: Split mixed group data and secrets**

Move conversation logs to `diagnostics`, sessions/tasks/apps/workflows/memory to `work`, preferences to `config`, OAuth/API keys to `secrets`, RAG artifacts to `knowledge`, and upload staging to `cache`. Replace raw keys in syncable records with secret references.

- [ ] **Step 3: Move extensions out of repository runtime directories**

Treat packaged repository Skills/Plugins as read-only seeds. Runtime install/update/uninstall, manifests, enabled state, marketplace cache, and generated Skill files live under `extensions` and use transactional staging/backups.

- [ ] **Step 4: Consolidate diagnostics writers and lifecycle**

Use one audit/log service with leases and flush/close. Remove the three competing direct writers to the same audit file.

- [ ] **Step 5: Verify routing and static audit**

Run: `pnpm storage:audit && pnpm test && pnpm typecheck`

Expected: PASS; user file-tool allowlist tests prove workspace output is unchanged.

- [ ] **Step 6: Commit**

```text
git commit -m "refactor(storage): route persistence through ASH groups"
```

### Task 7: Add storage APIs, Desktop lifecycle, onboarding, IPC, and relaunch recovery

**Files:**
- Create: `packages/backend/src/routes/storage.ts`
- Modify: `packages/backend/src/app.ts`
- Create: `packages/desktop/src/lifecycle/DesktopLifecycleController.ts`
- Create: `packages/desktop/src/lifecycle/DesktopLifecycleController.test.ts`
- Create: `packages/desktop/src/windows/createOnboardingWindow.ts`
- Create: `packages/desktop/src/windows/createMainWindow.ts`
- Create: `packages/desktop/src/ipc/registerStorageIpc.ts`
- Create: `packages/desktop/src/preload/main-preload.ts`
- Create: `packages/desktop/src/preload/onboarding-preload.ts`
- Create: `packages/desktop/src/onboarding/index.html`
- Create: `packages/desktop/src/onboarding/index.ts`
- Modify: `packages/desktop/src/main.ts`
- Modify or replace: `packages/desktop/src/preload.ts`
- Modify: `packages/desktop/electron-builder.yml`
- Modify: `packages/desktop/package.json`

**Interfaces:**
- Produces read APIs `/api/storage/overview|volumes|operations/:id|backups`.
- Produces schema-validated privileged IPC for selection, initialization, create/move/relocate/open/delete backup.

- [ ] **Step 1: Write failing controller and IPC tests**

Assert missing Bootstrap opens onboarding without starting Backend; initialization creates all groups; valid Bootstrap starts Backend and uses the returned port; migration commits then calls relaunch/exit; failed new-location health check restores previous; event subscriptions return disposers; untrusted senders are rejected.

- [ ] **Step 2: Implement one deterministic Desktop lifecycle**

Replace the blind timeout and unused `backendPort`. Start Backend only after storage initialization, wait for health, hold the server handle, close it on quit, and keep the same local origin/port policy across restarts.

- [ ] **Step 3: Build the required onboarding bundle**

It exposes only select parent, initialize default volume, state, and quit. The wizard cannot close into the main app; closing before completion exits.

- [ ] **Step 4: Implement storage IPC and progress events**

Renderer passes IDs and validated requests, never arbitrary write commands. Migration progress uses the shared structured event contract.

- [ ] **Step 5: Verify and package smoke**

Run: `pnpm --filter @manta/desktop test && pnpm --filter @manta/desktop build`

Expected: PASS and packaged resource configuration includes Frontend, Backend, Storage Hub, RAG, and native SQLite dependencies.

- [ ] **Step 6: Commit**

```text
git commit -m "feat(desktop): add ASH onboarding and migration lifecycle"
```

### Task 8: Add the shared Storage settings UI and migrate browser persistence

**Files:**
- Create: `packages/frontend/src/features/storage/StorageSettingsPanel.tsx`
- Create: `packages/frontend/src/features/storage/StorageOverview.tsx`
- Create: `packages/frontend/src/features/storage/StorageVolumeCard.tsx`
- Create: `packages/frontend/src/features/storage/StorageGroupRow.tsx`
- Create: `packages/frontend/src/features/storage/StorageOperationDialog.tsx`
- Create: `packages/frontend/src/features/storage/storage-api.ts`
- Create: `packages/frontend/src/features/storage/desktop-storage-bridge.ts`
- Create: `packages/frontend/src/features/storage/useStorageOperation.ts`
- Create: `packages/frontend/src/features/storage/StorageSettingsPanel.test.tsx`
- Create: `packages/frontend/src/migrations/browser-storage-importer.ts`
- Create: `packages/frontend/src/migrations/browser-storage-importer.test.ts`
- Modify: `packages/frontend/src/components/SettingsModal.tsx`
- Modify: `packages/frontend/src/pages/settings/page.tsx`
- Modify: `packages/frontend/src/vite-env.d.ts`
- Modify: theme/sidebar/task/webhook/RAG staged-file persistence files identified by the audit
- Create Backend config/cache endpoints and stores under `packages/backend/src/routes/storage-client-state.ts` and `packages/backend/src/storage/client-state-store.ts`

**Interfaces:**
- Produces one Storage panel reused by modal and route settings.
- Produces idempotent browser-to-ASH migration that deletes browser records only after Backend persistence succeeds.

- [ ] **Step 1: Write failing UI and importer tests**

Cover volume/group rendering, capacity/error states, migration confirmation/progress, operation lockout, listener cleanup, importer retry, write failure retention, and successful key deletion.

- [ ] **Step 2: Implement the shared panel and typed Electron API**

Add `storage` to the modal tabs and route query/tab handling without duplicating state logic. Replace local Electron type assertions with one global shared contract.

- [ ] **Step 3: Move durable localStorage/IndexedDB facts to ASH**

Theme/Webhook/sidebar preferences use config endpoints; RAG staged Files use cache upload APIs. Browser storage may retain only versioned derived startup cache, never canonical state.

- [ ] **Step 4: Verify**

Run: `pnpm --filter @manta/frontend test && pnpm --filter @manta/frontend build`

Expected: PASS.

- [ ] **Step 5: Commit**

```text
git commit -m "feat(settings): add ASH storage management"
```

### Task 9: Phase 1 end-to-end fault and acceptance verification

**Files:**
- Create: `packages/storage-hub/src/acceptance/storage-foundation.acceptance.test.ts`
- Create: `packages/desktop/e2e/storage-onboarding.e2e.ts`
- Create: `packages/desktop/e2e/storage-migration.e2e.ts`
- Create: `scripts/verify/ash-phase1.ts`
- Modify: root `package.json` verification scripts
- Create: `.github/workflows/ash.yml`

**Interfaces:**
- Produces a single `pnpm verify:ash:phase1` command covering the 12 phase-1 acceptance criteria in the design.

- [ ] **Step 1: Write acceptance tests mapped one-to-one to design section 20 items 1–12**

Tests use real temp roots, controlled Backend writes, an application relaunch test seam, and injected copy/validation/startup failures.

- [ ] **Step 2: Run red and close every uncovered requirement**

Run: `pnpm verify:ash:phase1`

Expected before completion: FAIL listing unmet criterion IDs.

- [ ] **Step 3: Verify Windows locally and configure Windows/macOS CI**

Run final local commands:

```text
pnpm storage:audit
pnpm test
pnpm typecheck
pnpm build
pnpm verify:ash:phase1
```

Expected: all PASS with no warnings that invalidate persistence or migration.

- [ ] **Step 4: Commit**

```text
git commit -m "test(storage): verify ASH migration acceptance"
```

---

## Phase 2 — Per-volume Git and Cloud-folder Reliability

### Task 10: Implement Git capability discovery and volume binding

**Files:**
- Create: `packages/storage-hub/src/sync/git/types.ts`
- Create: `packages/storage-hub/src/sync/git/git-runner.ts`
- Create: `packages/storage-hub/src/sync/git/git-binding-store.ts`
- Create: `packages/storage-hub/src/sync/git/git-runner.test.ts`
- Modify Backend storage APIs, Desktop IPC, Shared schemas, and StorageVolumeCard for Git binding.

**Interfaces:**
- Produces injected `GitRunner.exec(args, options)`, Git version/capability state, and one binding per volume.

- [ ] **Step 1: Write failing tests for missing Git, version parsing, noninteractive environment, redaction, and one-binding invariant**
- [ ] **Step 2: Implement with `execFile`, explicit binary discovery, `GIT_TERMINAL_PROMPT=0`, no shell strings, and redacted errors**
- [ ] **Step 3: Add manual/local-only and remote binding UI flows**
- [ ] **Step 4: Run `pnpm test && pnpm typecheck` and commit `feat(sync): bind Git repositories to volumes`**

### Task 11: Implement consistent volume snapshots and Git push

**Files:**
- Create: `packages/storage-hub/src/sync/snapshot-builder.ts`
- Create: `packages/storage-hub/src/sync/sync-manifest.ts`
- Create: `packages/storage-hub/src/sync/git/git-sync-service.ts`
- Create: corresponding tests with real temporary Git repositories.

- [ ] **Step 1: Write tests for SQLite checkpoint, excluded transient files, full group hashes, commit/push, offline remote, and retry**
- [ ] **Step 2: Build snapshots under cache after acquiring volume leases; never checkout over the live volume**
- [ ] **Step 3: Commit/push all valid persistent groups in the volume and persist last synced hashes**
- [ ] **Step 4: Run targeted and full tests; commit `feat(sync): snapshot and push ASH volumes`**

### Task 12: Implement fetch, three-way conflict detection, and transactional import

**Files:**
- Create: `packages/storage-hub/src/sync/conflict-planner.ts`
- Create: `packages/storage-hub/src/sync/import-coordinator.ts`
- Create: tests for local-only, remote-only, disjoint group changes, same-group conflict, immutable additions, database conflict, and rollback.
- Modify Storage UI with conflict choices: keep local, keep remote, duplicate asset.

- [ ] **Step 1: Write failing three-way state tests using `lastSyncedGroupHashes`**
- [ ] **Step 2: Implement fetch-to-staging, schema/hash validation, and group-level conflict plans**
- [ ] **Step 3: Apply accepted remote changes through MigrationCoordinator and relaunch**
- [ ] **Step 4: Verify and commit `feat(sync): safely import Git volume changes`**

### Task 13: Add cloud-folder health, scheduling, and Phase 2 acceptance

**Files:**
- Create: `packages/storage-hub/src/volumes/folder-health.ts`
- Create: `packages/storage-hub/src/sync/scheduler.ts`
- Add Backend/Desktop lifecycle integration, UI status, conflict-copy detection, and acceptance tests.

- [ ] **Step 1: Write tests for offline root, unreadable placeholder, conflict-copy names, scheduler overlap, and iCloud+Git stability recheck**
- [ ] **Step 2: Implement polling/inventory health; do not depend on `fs.watch` alone**
- [ ] **Step 3: Implement manual/startup/interval scheduling with one operation at a time**
- [ ] **Step 4: Run `pnpm verify:ash:phase2`, full gates, and commit `test(sync): verify volume synchronization`**

---

## Phase 3 — Content Addressing, Deduplication, and Storage Insights

### Task 14: Implement per-volume CAS and safe materialization

**Files:**
- Create: `packages/storage-hub/src/content-store/object-store.ts`
- Create: `packages/storage-hub/src/content-store/manifest-store.ts`
- Create: `packages/storage-hub/src/content-store/materialize.ts`
- Create: tests for SHA-256 identity, atomic ingest, hardlink/reflink/copy fallback, path safety, and immutable replacement.

- [ ] **Step 1: Write failing tests using real duplicate files**
- [ ] **Step 2: Implement `.ash/objects/sha256/<prefix>/<hash>` and asset manifests**
- [ ] **Step 3: Materialize immutable objects safely and verify content after fallback**
- [ ] **Step 4: Verify and commit `feat(storage): add content addressed assets`**

### Task 15: Integrate documents, Skills, Plugins, and Marketplace packages with CAS

**Files:**
- Modify knowledge upload/source-document storage and extension install/seed flows.
- Create migration tests from ordinary files to CAS manifests without data loss.

- [ ] **Step 1: Write tests proving duplicate documents/packages result in one object per volume**
- [ ] **Step 2: Ingest original documents and immutable extension packages through CAS while keeping active databases/config outside CAS**
- [ ] **Step 3: Preserve existing asset IDs and rollback failed conversions**
- [ ] **Step 4: Verify and commit `refactor(storage): deduplicate knowledge and extensions`**

### Task 16: Implement reference-safe GC and truthful capacity metrics

**Files:**
- Create: `packages/storage-hub/src/content-store/garbage-collector.ts`
- Extend inventory DTO/API/UI for logical bytes, physical bytes, dedup saved bytes, sync cache, and cleanable bytes.
- Create tests for references, pending operations, cross-volume duplicates, and metric recomputation.

- [ ] **Step 1: Write failing metric and GC safety tests**
- [ ] **Step 2: Implement candidate quarantine and require a clean full scan before deletion**
- [ ] **Step 3: Display only recomputable savings; never count cross-volume or Git replicas as dedup savings**
- [ ] **Step 4: Run `pnpm verify:ash:phase3`, full gates, and commit `feat(storage): report verified dedup savings`**

---

## Phase 4 — External Agent Assets and Codex Adapter

### Task 17: Implement AgentAdapter contracts, preview plans, journals, and backups

**Files:**
- Create: `packages/storage-hub/src/adapters/types.ts`
- Create: `packages/storage-hub/src/adapters/adapter-registry.ts`
- Create: `packages/storage-hub/src/adapters/projection-coordinator.ts`
- Create: tests for preview-only behavior, path authorization, backup, rollback, and journal recovery.

- [ ] **Step 1: Write failing contract and coordinator tests**
- [ ] **Step 2: Implement detect/inspect/planImport/planProjection/apply with no Harness concerns**
- [ ] **Step 3: Require approved immutable plans and backup every changed native file**
- [ ] **Step 4: Verify and commit `feat(adapters): add external Agent asset framework`**

### Task 18: Implement the Codex adapter from official, current formats

**Files:**
- Create: `packages/storage-hub/src/adapters/codex/detect.ts`
- Create: `packages/storage-hub/src/adapters/codex/skills.ts`
- Create: `packages/storage-hub/src/adapters/codex/instructions.ts`
- Create: `packages/storage-hub/src/adapters/codex/mcp.ts`
- Create: `packages/storage-hub/src/adapters/codex/index.ts`
- Create fixture-based tests for detection, inspect, import, projection, conflicts, backups, and secrets separation.

- [ ] **Step 1: Verify CODEX_HOME, Skills, AGENTS/Instructions, and MCP formats against official OpenAI documentation at implementation time**
- [ ] **Step 2: Write failing fixture tests for every supported mapping**
- [ ] **Step 3: Implement preview/import/projection; keep MCP credentials as secret references and prefer hardlink/reflink for immutable same-volume assets**
- [ ] **Step 4: Verify and commit `feat(adapters): connect Codex to ASH assets`**

### Task 19: Add Agent connection UI and Phase 4 acceptance

**Files:**
- Create Frontend Agent Storage connection components and Backend/Desktop adapter endpoints/IPC.
- Create acceptance tests for detect, inspect, preview, apply, rollback, and reuse statistics.

- [ ] **Step 1: Write failing UI and end-to-end adapter tests**
- [ ] **Step 2: Implement connection status, asset selection, preview diff, approval, progress, and rollback result**
- [ ] **Step 3: Verify no external Agent Harness execution is introduced**
- [ ] **Step 4: Run `pnpm verify:ash:phase4`, full gates, and commit `test(adapters): verify Codex asset integration`**

---

## Final Completion Audit

### Task 20: Prove every design requirement and ship a clean build

**Files:**
- Create: `docs/superpowers/verification/2026-07-11-agent-storage-hub.md`
- Update user/developer documentation, troubleshooting, and packaging metadata.

- [ ] **Step 1: Build a requirement-to-evidence matrix for every numbered design acceptance item and each phase completion standard**
- [ ] **Step 2: Run all local verification commands from a clean checkout/install**

```text
pnpm install --frozen-lockfile
pnpm storage:audit
pnpm test
pnpm typecheck
pnpm build
pnpm verify:ash:phase1
pnpm verify:ash:phase2
pnpm verify:ash:phase3
pnpm verify:ash:phase4
```

- [ ] **Step 3: Run packaged Electron smoke/E2E and inspect rendered onboarding and Storage UI**
- [ ] **Step 4: Confirm Git status contains only intended changes and no runtime data, credentials, generated cache, or migration fixtures**
- [ ] **Step 5: Request code review, address findings with tests first, and commit final documentation**

```text
git commit -m "docs: complete Agent Storage Hub verification"
```
