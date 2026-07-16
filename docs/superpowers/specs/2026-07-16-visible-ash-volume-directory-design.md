# Visible ASH Volume Directory Design

## Goal

Replace the hidden ASH volume directory name `.manta-ai` with the visible name `manta-ai-data`, including the existing local volume, without changing ASH group layout or losing data.

## Design

- `ASH_VOLUME_DIR_NAME` in `packages/shared/src/constants.ts` is the single runtime source of truth and becomes `manta-ai-data`.
- Runtime path construction must import or derive from that constant. User-facing text must display `manta-ai-data` rather than embed the legacy name.
- Initialization and migration transaction directories derive visible names from the configured directory name, such as `manta-ai-data.initializing-<id>` and `manta-ai-data.migrating-<id>`.
- The current volume is renamed atomically from `/Users/example/Documents/.manta-ai` to `/Users/example/Documents/manta-ai-data` while Desktop is stopped. The bootstrap stores the selected parent directory, so its schema does not change.
- If both legacy and new directories exist, no automatic merge or overwrite is allowed.
- Legacy `.manta-ai` strings may remain only in explicit compatibility tests or historical documentation. Active guides, UI, verification scripts, and security fixtures use the new name.

## Validation

- Start with failing tests asserting `manta-ai-data` for POSIX, Windows, initialization, routing, migration, API paths, and visible UI text.
- Run ASH Phase 1–4, type checking, build, storage audit, and focused frontend/Desktop tests.
- Restart the real Electron app and verify its API reports `/Users/example/Documents/manta-ai-data`, seven healthy groups, and detected Codex assets.
- Confirm the old directory no longer exists and the new directory contains the existing data.

## Safety

- Stop Electron before renaming the active directory.
- Use a same-parent atomic rename; do not copy, delete, merge, or overwrite.
- Preserve unrelated uncommitted changes and do not commit, push, or deploy.
