# Agent Storage Hub verification record

Verified on 2026-07-15 and completed on 2026-07-16 from branch `codex/agent-storage-hub`, using an isolated worktree based on `d338928` plus the Task 20 changes, on Windows with pnpm 10.30.3. The design source is [2026-07-11-agent-storage-hub-design.md](../specs/2026-07-11-agent-storage-hub-design.md).

## Requirement-to-evidence matrix

| Requirement | Evidence | Result |
|---|---|---|
| Phase 1.1: required first-run location and fixed `.manta-ai` name | `storage-foundation.acceptance.test.ts`; `storage-onboarding.e2e.ts`; `verify:ash:phase1` | Pass |
| Phase 1.2: all seven groups routed; no `.manta-data` or runtime repository `.manta` writes | storage foundation acceptance; Backend runtime tests; `storage:audit` over 337 production files | Pass |
| Phase 1.3: durable browser localStorage/IndexedDB removed or migrated | Frontend browser storage and legacy RAG migration tests; `browser-rag-storage.e2e.ts` | Pass |
| Phase 1.4: Storage shows volume/group paths, sizes, counts, and states | Storage API, settings panel, desktop E2E, Phase 1 endpoint checks, rendered inspection | Pass |
| Phase 1.5: safe full-volume relocation and restart | migration fault matrix; `storage-migration.e2e.ts`; desktop lifecycle recovery tests | Pass |
| Phase 1.6: create another volume and move a group | storage foundation acceptance and desktop migration E2E | Pass |
| Phase 1.7: file and group validation; failure does not switch mapping | migration coordinator copy/hash/driver failure matrix | Pass |
| Phase 1.8: post-commit startup failure restores previous configuration | RelaunchRecovery and DesktopLifecycleController tests; migration acceptance | Pass |
| Phase 1.9: source retained as backup and active volume protected | storage foundation acceptance; migration E2E byte-for-byte backup assertion; ASH excludes the backup from active routing/deletion (filesystem read-only permissions are not enforced) | Pass with documented permission limitation |
| Phase 1.10: subsequent internal writes use the new path | Backend runtime routing and `storage-migration.e2e.ts` HTTP write assertion | Pass |
| Phase 1.11: explicit project/Agent output paths remain unchanged | storage audit user-output boundary fixtures and runner tests | Pass |
| Phase 1.12: Windows/macOS path, permissions, and restart automation | path-router, inventory/link, durable I/O, desktop lifecycle tests; `storage:audit` | Pass |
| Phase 2 completion: one Git binding per volume; snapshot/sync/conflict/safe import; cloud offline/conflict handling | folder health, scheduler, Git runner/import/conflict tests, desktop cloud runtime; `verify:ash:phase2` | Pass |
| Phase 3 completion: one physical copy for duplicate document/Skill/Plugin content with reproducible savings | CAS object/reference/GC/allocation/capacity tests, pending-reference integration, no-false-savings UI; `verify:ash:phase3` | Pass |
| Phase 4 completion: bidirectional Codex Skills/Instructions/non-sensitive MCP preview/apply without Harness replacement | Codex adapter, projection coordinator, Backend CAS service, sender-bound IPC, accessible UI, credential and Harness guards; `verify:ash:phase4` | Pass |

## Fresh command evidence

Commands ran fail-fast from the repository root after a frozen install. Durations are wall-clock seconds.

| Command | Exit | Duration | Evidence summary |
|---|---:|---:|---|
| `pnpm install --frozen-lockfile` | 0 | 2.208 | Lockfile accepted; workspace dependencies current |
| `pnpm storage:audit` | 0 | 14.163 | Audit tests passed; 337 production source files scanned |
| `pnpm test` | 0 | 21.300 | 14/14 Turbo tasks; 91 Vitest files and 661 Vitest tests passed, plus 3 Desktop script tests |
| `pnpm typecheck` | 0 | 37.227 | 12/12 selected tasks passed with serial Turbo scheduling |
| `pnpm build` | 0 | 28.850 | All selected workspace packages built with serial Turbo scheduling |
| `pnpm verify:ash:phase1` | 0 | 85.560 | Numbered criteria 1–12 passed |
| `pnpm verify:ash:phase2` | 0 | 39.007 | Git/cloud completion standard passed |
| `pnpm verify:ash:phase3` | 0 | 71.177 | CAS/capacity completion standard passed |
| `pnpm verify:ash:phase4` | 0 | 26.978 | Codex adapter completion standard passed |
| `pnpm --filter @manta/desktop test:e2e:ash` | 0 | 22.026 | 3 files, 4 onboarding/migration/browser tests passed |
| `pnpm --filter @manta/desktop package:dir` | 0 | 78.032 | 7 runtime resources, 4 providers, composition, full server, routed conversations/workspaces APIs, and actual packaged main verified |

The Windows artifact is `packages/desktop/release/win-unpacked/Manta.exe`. It is generated and excluded from Git.

The root `test` script sets Turbo concurrency to one so the required literal `pnpm test` gate is deterministic on Windows hosts under foreground load. Before that root setting, three parallel attempts produced only drifting wall-clock timeouts in different filesystem/Git tests; every focused rerun passed. The exact command now passes without weakening package-wide timeouts. The one multi-stage Agent composition test has a focused 30-second bound because it exercises import, projection, restart, rollback, and reuse evidence in one case.

## Rendered inspection evidence

- Before the final package-only fixes, the packaged onboarding rendered readable Simplified Chinese labels, enabled confirmation after folder selection, created the fixed `.manta-ai` root, and relaunched.
- The packaged Storage tab rendered the Default volume, its path and capacity, Open/Migrate/Git controls, and all seven groups as healthy.
- The first Agent Connections inspection exposed a real error, and the first hidden post-fix run exposed an empty-conversation refetch loop. After fixing TOML literal-string parsing and bounding the fallback request, the final hidden packaged renderer responded in 0.5 seconds and remained idle (1.44 renderer CPU seconds over a 5-second profile rather than the prior sustained 100%). Storage showed one healthy volume, all seven groups healthy with file/size metrics, capacity and savings metrics, and the Default `.manta-ai` volume with Open/Migrate, Git, Create volume, and automatic-backup controls.
- The final Agent Connections render showed Codex `Status: detected`, sanitized `.codex` and `.agents\skills` roots, native Skill import checkboxes, portable Skills/Instructions/MCP server sections with preview controls, and the secret-literals warning. Screenshots were inspected without exposing credentials, then removed; the packaged app was stopped with no process left running.
- The final package smoke compensates at the release boundary by starting the actual packaged main/server and requiring successful real TCP responses from both conversations and workspaces routed-storage APIs. Desktop E2E separately covers onboarding, migration, restart, and browser-to-ASH persistence.

## Verification findings addressed

- Refreshed exact security-audit callsites after Phase 4 and packaging code moved.
- Updated immutable-extension concurrency coverage to prove a synchronous competing lease is rejected while the first transaction owns it.
- Gave the focused Windows directory-claim rollback test a 10-second timeout and the multi-stage Agent composition integration test a 30-second timeout; both remain bounded and pass in the final suite.
- Added CommonJS output and conditional exports for `@manta/shared`; the first packaged launch exposed a missing CJS entry.
- Bundled onboarding TypeScript as a browser IIFE and added readable-label/browser-execution tests; loading raw CommonJS output had failed in the renderer.
- Removed duplicate Fastify multipart registration and added a full-app readiness regression; the duplicate parser blocked packaged server startup.
- Added TOML single-quoted literal-string support for real Codex MCP commands and environment entries while preserving secret separation and fail-closed parsing.
- Scoped 2PC recovery enumeration to the first, always-first-persisted participant so Config/Secrets and Knowledge/Secrets cohorts cannot misclassify each other's shared Secrets journals during restart.
- Pinned every Backend internal alias to compiled `dist` during packaging. The previous esbuild closure mixed `src` and `dist`, creating two ASH `AsyncLocalStorage` instances; the final smoke now fails unless real routed APIs return success.
- Bounded the empty-conversation fallback to one request per mounted sidebar. Hidden packaged-renderer inspection exposed the former successful-empty-response loop at 100% renderer CPU; the focused regression, full suite, rebuilt frontend, and packaged smoke now pass.

Generated release directories, coverage, package staging, command logs, Turbo logs, runtime volumes, credentials, caches, and migration fixtures are excluded from the intended commit.

## Final independent-review addendum (2026-07-16)

The final broad review identified and closed five release blockers after the original Task 20 record:

- Git import replacement now uses a durable import journal, one exclusive lease, deterministic staging/backups, and all-old/all-new crash recovery.
- Bootstrap creation and relocation now share a serialized cross-process update lock; concurrent volume creation and post-commit lock-release failures preserve the committed catalog.
- Git bindings persist the discovered remote branch. Existing `main`/`trunk` repositories, empty remotes, cache rebuilds, and a transient branch-discovery failure are covered with real bare-repository tests. A failed `ls-remote` now rolls back without persisting the local fallback branch.
- Secrets remain excluded from Git by default. Enabling them requires an expiring, one-use native confirmation grant bound to sender, frame, origin, and volume; disabling immediately removes cached/indexed copies without deleting live ASH secrets.
- The Storage UI exposes the high-risk Secrets option and warning only for an established Git binding; renderer input cannot add the policy through ordinary Git configuration.

An independent re-review of `e41fe1a..3cb92fa` found no remaining Critical or Important issue. Fresh latest-HEAD gates then passed:

| Command | Result |
|---|---|
| `pnpm install --frozen-lockfile` | Pass |
| `pnpm storage:audit` | Pass; 338 production source files scanned |
| `pnpm test` | Pass; 14/14 Turbo tasks |
| `pnpm typecheck` | Pass; 12/12 tasks |
| `pnpm build` | Pass; 7/7 tasks |
| `pnpm verify:ash:phase1` through `phase4` | Pass |
| `pnpm --filter @manta/desktop test:e2e:ash` | Pass; 3 files / 4 tests |
| `pnpm --filter @manta/desktop package:dir` | Pass; packaged runtime, providers, server, routed APIs, and actual main verified |

The packaged Storage screen had already received a hidden rendered inspection for layout, health, capacity, migration, Git, and Agent Connection behavior. The later Secrets control is additionally covered by static-render UI assertions and privileged native-confirmation IPC tests. No release or inspection process remained running after verification.
