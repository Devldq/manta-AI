# Onboarding Real Initialization Progress Design

## Goal

Keep the onboarding window visible while Manta AI performs initialization, show every completed real step as an animated row, and transition to the main window without restarting Electron.

## User Experience

After a parent folder is selected and confirmed, the folder controls become unavailable and a progress list appears. Each row has one of four states: pending, active, complete, or failed. Only the active row animates; completed rows show a checkmark. The list follows the active row without hiding prior evidence.

The ordered steps are:

1. Validate the selected storage parent.
2. Create `manta-ai-data`.
3. Create all seven storage groups.
4. Write the volume manifest.
5. Commit the Bootstrap.
6. Verify the initialized storage and group health.
7. Initialize ASH and Codex services.
8. Start the Backend server and pass its health check.
9. Open the main window.

No step is completed by a timer. A row changes to complete only after the Main Process operation it represents has succeeded.

## Architecture

### Shared progress contract

Desktop defines a closed `OnboardingProgress` contract containing the ordered step id, state, user-facing label, and optional sanitized error. The renderer cannot submit arbitrary step state.

### Storage initialization

`initializeStorage` accepts an optional progress callback. It emits progress around the existing security boundaries: parent validation, staging-root creation, seven-group creation, manifest write, Bootstrap commit, and final read-back verification. Existing callers remain compatible.

### Trusted IPC bridge

The onboarding Main Process sends progress only to the currently registered canonical onboarding `BrowserWindow`. The preload exposes a subscribe function that returns an unsubscribe callback. Navigation and sender checks remain unchanged. Errors are sanitized before reaching the renderer.

### Same-process startup transition

The initialization IPC no longer calls `app.relaunch()` or `app.quit()`. After storage initialization succeeds, a Desktop-owned continuation composes ASH/Codex, starts the Backend, checks health, opens the main window, and only then closes the onboarding window. The controller owns this continuation so startup ordering remains centralized.

The onboarding close handler distinguishes a successful handoff from a user-initiated close, so closing the old window after the main window opens cannot quit the app.

## Failure and Retry

On failure, the onboarding window remains visible. The failed row displays a sanitized error and the completed rows remain complete. The UI provides:

- Retry, which resumes through the authoritative initialization path.
- Choose another location, available only when Bootstrap was not committed.
- Quit.

If Bootstrap was committed but service startup failed, retry reuses the committed volume and never creates a second volume or overwrites data.

## Security

- All filesystem and lifecycle operations remain in the Main Process.
- Renderer progress is read-only and schema-bound.
- Progress events are sent only to the canonical onboarding main frame.
- Native paths and raw stack traces are not included in renderer errors.
- Bootstrap remains the commit boundary: pre-commit failure cannot open the main window.

## Verification

- Unit tests prove exact progress order and that events occur after real operations.
- Failure tests prove the failed step remains visible and no relaunch/quit occurs.
- IPC/preload tests prove listener cleanup and trusted-window routing.
- Lifecycle tests prove same-process service startup, health check, main-window opening, and onboarding handoff.
- Renderer tests prove accessible pending/active/complete/failed states without timer-based completion.
- Desktop E2E performs a real first-run initialization and records every required phase before the main Backend becomes reachable.
- ASH Phase 1–4, typecheck, audit, and build remain green.
