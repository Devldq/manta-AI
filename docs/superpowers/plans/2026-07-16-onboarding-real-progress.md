# Onboarding Real Initialization Progress — Implementation Plan

> **For Codex:** Execute this plan task-by-task with test-driven development. Do not commit or push unless the user explicitly requests it.

**Goal:** After the user selects a storage parent, keep the onboarding window visible while showing nine real, event-driven initialization steps, then transition to the main window in the same Electron process.

**Architecture:** A typed progress event flows from storage initialization and `DesktopLifecycleController` through the trusted onboarding IPC sender and preload bridge to a deterministic renderer state model. Storage work remains security-bound to the main process. The desktop lifecycle exposes a same-process continuation path after Bootstrap commits; successful handoff closes onboarding without triggering the existing “user closed onboarding” quit behavior.

**Tech Stack:** TypeScript, Electron IPC/preload, Vitest, existing desktop lifecycle and storage modules.

---

## Task 1: Define the progress contract and storage phase events

**Files:**

- Create: `packages/desktop/src/onboarding/progress-contract.ts`
- Modify: `packages/desktop/src/lifecycle/initializeStorage.ts`
- Test: `packages/desktop/src/lifecycle/initializeStorage.test.ts`

### Step 1: Write failing tests

Add tests that pass an `onProgress` callback to `initializeStorage` and assert the exact successful storage sequence:

```text
validate-parent: active, complete
create-volume: active, complete
create-groups: active, complete
write-manifest: active, complete
commit-bootstrap: active, complete
verify-storage: active, complete
```

Add a fault-injection test asserting that the currently active phase emits `failed`, later phases never emit, and Bootstrap is not committed before its real boundary.

Run `pnpm --filter @manta/desktop test -- initializeStorage.test.ts` and expect failure because progress is not implemented yet.

### Step 2: Add the typed contract

Define the nine ordered step IDs, state union, event shape, reporter type, and renderer labels. Keep IDs stable and serializable. Do not include paths or sensitive error details in renderer events.

### Step 3: Emit at real storage boundaries

Wrap only actual operations:

- parent validation;
- secure staging volume creation;
- seven required group directories;
- manifest write;
- final directory rename plus Bootstrap commit;
- manifest, Bootstrap, directory, and group readback verification.

On a thrown error, emit `failed` for the active step and rethrow the existing typed initialization error. Do not use delays or simulated percentages.

### Step 4: Verify Task 1

Run:

```bash
pnpm --filter @manta/desktop test -- initializeStorage.test.ts
pnpm --filter @manta/desktop typecheck
```

Expected: PASS.

## Task 2: Continue desktop startup in the same process

**Files:**

- Modify: `packages/desktop/src/lifecycle/DesktopLifecycleController.ts`
- Test: `packages/desktop/src/lifecycle/DesktopLifecycleController.test.ts`

### Step 1: Write failing lifecycle tests

Add a test that first enters onboarding, then calls the new continuation API after Bootstrap exists. Assert `recover`, `startServer`, health check, and `openMain` all run without a restart. Assert lifecycle progress is exactly:

```text
initialize-services: active, complete
start-backend: active, complete
open-main: active, complete
```

Add failure tests for service initialization and backend health. The active phase must become `failed`; `openMain` must not run after a prior failure.

Run `pnpm --filter @manta/desktop test -- DesktopLifecycleController.test.ts` and expect failure.

### Step 2: Refactor initialized boot into one reusable path

Extract the existing Bootstrap-present sequence into a private method used by both normal startup and a public `continueAfterOnboarding(onProgress)` method. Preserve existing recovery and cleanup semantics. Emit completion only after the corresponding awaited operation succeeds.

### Step 3: Verify Task 2

Run the lifecycle test and desktop typecheck; both must pass.

## Task 3: Replace relaunch with a trusted IPC-to-lifecycle handoff

**Files:**

- Modify: `packages/desktop/src/ipc/registerOnboardingIpc.ts`
- Modify: `packages/desktop/src/desktop-runtime.ts`
- Modify: `packages/desktop/src/preload/onboarding-preload.ts`
- Test: `packages/desktop/src/ipc/registerOnboardingIpc.test.ts`
- Test: `packages/desktop/src/preload/onboarding-preload.test.ts`

### Step 1: Write failing IPC and preload tests

Assert that initialization forwards progress only to trusted onboarding web contents, runs storage then lifecycle continuation, and never relaunches or quits on success. Assert preload exposes only a narrow validated `onProgress(listener)` subscription with unsubscribe behavior.

Run the two focused test files and expect failure.

### Step 2: Implement the narrow event bridge

Send `onboarding:progress` using the already validated sender. Never expose raw `ipcRenderer`. Retain the consumed canonical parent path only inside the IPC registration closure so the same trusted window can retry; clear it on disposal or when a new selection supersedes it.

### Step 3: Implement successful handoff without quitting

Wire lifecycle continuation into the IPC dependency. After the IPC response is deliverable, close onboarding under an explicit handoff flag. Manual close before completion must still quit, while a completed handoff must not.

### Step 4: Verify Task 3

Run the two focused tests and desktop typecheck; all must pass.

## Task 4: Render an accessible deterministic progress list

**Files:**

- Create: `packages/desktop/src/onboarding/progress-model.ts`
- Create: `packages/desktop/src/onboarding/progress-model.test.ts`
- Modify: `packages/desktop/src/onboarding/index.ts`
- Modify: `packages/desktop/src/onboarding/index.html`

### Step 1: Write failing state-model tests

Test that all nine rows begin pending, real events advance only their rows, completion persists, failure stores a safe message, retry preserves earlier completion while resetting the failed and later rows, and regressive events cannot corrupt completed rows.

Run the focused model test and expect failure.

### Step 2: Implement the model and renderer

Render all rows before initialization. Subscribe before invoking initialization. Provide text plus non-color-only state indicators: neutral dot, CSS spinner with `aria-current`, check mark, or error icon. Before a Bootstrap commit failure allow choosing another location; after commit offer retry only. Keep the window visible and use no artificial timers.

### Step 3: Verify Task 4

Run the model test and desktop typecheck; both must pass.

## Task 5: End-to-end verification and regression closure

**Files:**

- Modify: `packages/desktop/e2e/storage-onboarding.e2e.ts`
- Review: all modified files

### Step 1: Extend the E2E test

Capture storage and lifecycle progress in one run. Assert all nine steps complete in order, Bootstrap points to the selected `manta-ai-data` root, all seven groups exist, backend health succeeds, and the main window opens in the same controller/process.

### Step 2: Run targeted and full verification

Use the scripts available in the repository and record missing scripts rather than substituting unrelated checks:

```bash
pnpm --filter @manta/desktop test
pnpm --filter @manta/desktop typecheck
pnpm --filter @manta/desktop lint
pnpm --filter @manta/desktop build
pnpm --filter @manta/desktop test:e2e -- storage-onboarding.e2e.ts
```

### Step 3: Run a real Electron acceptance pass

Using a disposable parent, verify the visible rows, filesystem boundaries, same-process main-window handoff, non-hidden `manta-ai-data`, valid Bootstrap and groups, backend health, and ASH/Codex service availability. Do not delete user backups or current data.

### Step 4: Inspect the final diff

Run:

```bash
git diff --check
git diff -- packages/desktop/src packages/desktop/e2e docs/superpowers
```

Confirm there are no unrelated rewrites, debug logs, secrets, simulated progress timers, or restart calls in the successful onboarding path.
