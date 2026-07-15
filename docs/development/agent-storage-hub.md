# Agent Storage Hub development and packaging

`@manta/storage-hub` is the Node/TypeScript core for volume registry, routing, inventory, migration, Git/cloud synchronization, content-addressed storage, and external Agent adapters. Desktop owns privileged lifecycle and IPC; Backend receives routed group roots; Frontend uses typed HTTP/IPC contracts. Production persistence must not construct its own home-directory data root.

## Verification

From the repository root with pnpm 10.30.3, run:

```powershell
pnpm install --frozen-lockfile
pnpm storage:audit
pnpm test
pnpm typecheck
pnpm build
pnpm verify:ash:phase1
pnpm verify:ash:phase2
pnpm verify:ash:phase3
pnpm verify:ash:phase4
pnpm --filter @manta/desktop test:e2e:ash
pnpm --filter @manta/desktop package:dir
```

The static audit uses `scripts/security/ash-storage-allowlist.json`. Entries are exact reviewed callsites, not broad path exemptions. When a reviewed callsite moves, confirm that its trust boundary is unchanged and update file, line, column, operation, and reason together. Stale entries intentionally fail the audit.

Phase scripts are the durable acceptance entry points. Phase 1 maps all twelve numbered design criteria to storage, desktop, browser migration, recovery, and audit evidence. Phases 2–4 cover Git/cloud reliability, truthful volume-local content accounting, and the secret-safe Codex adapter contract.

## Windows directory package

`package:dir` builds Desktop, prepares a flattened runtime closure, creates `packages/desktop/release/win-unpacked`, restores the caller's Node ABI, and launches the actual packaged `dist/main.js` in smoke mode. Success must include:

```text
Verified 7 packaged runtime resources, 4 provider packages, packaged storage composition/server/routed APIs, and actual packaged dist/main.js
```

The inspectable executable is `packages/desktop/release/win-unpacked/Manta.exe`. Launch it with:

```powershell
Start-Process -FilePath (Resolve-Path 'packages/desktop/release/win-unpacked/Manta.exe')
```

For a visual release check, use an isolated user-data profile and verify the required onboarding screen, `.manta-ai` wording, disabled confirmation before selection, successful main-window launch, Storage volume/group metrics, migration controls, Git/cloud status, and Agent Connections preview/apply/rollback controls. Do not commit `release`, `.package-staging`, coverage, Turbo logs, user-data profiles, `.manta-ai` volumes, credentials, or smoke markers.

Release installers continue to use `packages/desktop/electron-builder.yml`; local directory smoke is unsigned and deliberately avoids release-signing dependencies.
