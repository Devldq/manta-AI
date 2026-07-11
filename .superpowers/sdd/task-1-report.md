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

## Reviewer fixes

### RED

- Added `packages/backend/src/core/llm/ai-sdk-provider.contract.test.ts`, which compiles the factory result directly into both `generateText` and `streamText` call boundaries.
- Removed the three prior call-site assertions and ran `pnpm --filter @manta/backend typecheck` — exit 2. The new contract and all three production call sites reported `LanguageModelV3 | LanguageModelV4` was not assignable to the `ai@6.0.177` V2/V3 `LanguageModel` input.
- Package inspection showed `ai@6.0.177` and `@ai-sdk/openai@3.0.63` depend on `@ai-sdk/provider@3`, while `@ai-sdk/anthropic@4.0.7` depends on provider V4 and returns `LanguageModelV4`.

### GREEN

- Aligned Anthropic to `@ai-sdk/anthropic@3.0.96`, whose dependency is `@ai-sdk/provider@3.0.14`; `createAISDKModel` now infers only call-compatible V3 models. No model assertion remains in compaction, agent loop, RAG, or the contract test.
- Added matching `@vitest/coverage-v8@^2.1.9` to all six packages. Each test script now emits JSON coverage under `coverage/`, prints a compact summary, and excludes test files from source coverage. Added `coverage/` to `.gitignore` while preserving Turbo's `coverage/**` output contract.
- `pnpm --filter @manta/backend typecheck` — exit 0.
- `pnpm --filter @manta/backend test` — exit 0; two files/two tests passed, including the provider call-boundary contract.
- `pnpm test` — exit 0; 10/10 tasks and seven tests passed across six packages. Each package emitted `coverage/coverage-final.json`; no Turbo missing-output warning.
- `pnpm typecheck` — exit 0; 10/10 tasks across six packages.
- `pnpm build` — exit 0; 6/6 packages. Only the pre-existing Vite chunk-size advisory remains.

### Provider behavior re-review

- Replaced the unused compile-helper/function-existence assertions with two real, awaited construction tests. Using explicit dummy keys, `.invalid` base URLs, and model IDs, the tests construct OpenAI-compatible and Anthropic models without invoking generation or sending a network request.
- The OpenAI-compatible result asserts `specificationVersion === 'v3'`, provider `openai.chat`, and the configured model ID. The Anthropic result asserts `specificationVersion === 'v3'`, provider `anthropic.messages`, and its configured model ID.
- Focused contract command — `pnpm --filter @manta/backend exec vitest run src/core/llm/ai-sdk-provider.contract.test.ts --coverage --coverage.reporter=text-summary --coverage.reporter=json --coverage.exclude=**/*.test.ts`: exit 0, one file/two tests passed.
- `pnpm --filter @manta/backend typecheck`: exit 0.
- `pnpm --filter @manta/backend test`: exit 0, two files/three tests passed.
- `pnpm test`: exit 0, 10/10 Turbo tasks and eight tests passed; coverage outputs recognized with no missing-output warnings.
- `pnpm typecheck`: exit 0, 10/10 Turbo tasks.
- `pnpm build`: exit 0, 6/6 Turbo tasks; the only warning is the separately noted pre-existing Vite chunk-size advisory.
