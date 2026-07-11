# Task 1 Report — Repair verification gates and establish test infrastructure

## Status

Complete. Root test, typecheck, and build gates cover all six current workspace packages and pass.

## RED evidence

### Known baseline

- `pnpm typecheck` — exit 2. Backend reported `LanguageModelV3 | LanguageModelV4` incompatibility at the three AI SDK call boundaries, invalid/missing `SkillSource`, `SkillSummary`, and `SkillType` contracts, nullable update result mismatch, and implicit-any RAG callbacks.
- `pnpm --filter @manta/agent-sandbox test` — exit 1 with `No test files found`.

### Supplemental baseline uncovered after cache miss

The first root typecheck replayed a stale frontend Turbo cache entry. A real cache miss after dependency installation exposed existing frontend errors: an unused `useLogStream.ts` depended on nonexistent sibling modules, RAG metadata values were `unknown` React children, `FileTab` omitted fields it rendered, browser APIs used incompatible broad casts, reconnect usage supplied optional values to required counters, and Markdown passed `boolean | undefined`. Extending the root gate to Desktop also exposed the missing type declaration for the backend server subpath.

## GREEN changes

- Added one real Vitest behavior assertion for Shared, RAG, Agent Sandbox, Backend, Frontend, and Desktop.
- Added package test scripts/dev dependencies, root Turbo test orchestration, and the specified `coverage/**` test output contract; updated only `pnpm-lock.yaml`.
- Expanded root build/typecheck filters to Shared, RAG, Agent Sandbox, Backend, Frontend, and Desktop.
- Typed AI SDK models precisely at `generateText`/`streamText` call boundaries.
- Restored authoritative Skill source variants, summary metadata/tools, `SkillType` import, and nullable update handling.
- Typed RAG callbacks and corrected Husky paths to `scripts/security/sensitive-check.ts` and `scripts/release/update-version.ts`.
- Repaired supplemental frontend/desktop type contracts without changing active behavior. Removed unreferenced `useLogStream.ts`, whose required implementation modules do not exist.

## GREEN verification

- Focused package tests: six baseline files, six assertions passed.
- `pnpm test` — exit 0; 10/10 Turbo tasks successful; six Vitest files and six tests passed. Turbo warns that no coverage files exist because the required task output is `coverage/**` while smoke tests do not enable coverage.
- `pnpm --filter @manta/frontend typecheck` — exit 0.
- `pnpm typecheck` — exit 0; 10/10 Turbo tasks successful across six packages.
- `pnpm build` — exit 0; 6/6 Turbo tasks successful. Vite retains the pre-existing large-chunk advisory (main JS ~1.28 MB minified).
- `git diff --check` — exit 0.

## Files

Configuration/manifests: `package.json`, `turbo.json`, six package manifests, `pnpm-lock.yaml`, and two Husky hooks. Tests: six `src/baseline.test.ts` files. Type repairs: the four specified backend files, shared Skill types, frontend RAG/skills/tasks files, removal of the broken unused log hook, and Desktop backend subpath declaration.

## Self-review and concerns

- No storage feature implementation was added.
- No `any`, `ts-ignore`, strictness reduction, or placeholder assertion was introduced by this task.
- `package-lock.json` is unchanged.
- The AI provider packages can return V4 models while the installed `ai` call signature accepts through V3; the precise call-boundary assertions preserve runtime behavior but dependency alignment should be revisited separately.
- Turbo's `coverage/**` declaration intentionally produces warnings until coverage is enabled; it is retained verbatim from the task brief.
- Vite's existing large bundle warning remains outside Task 1 scope.
