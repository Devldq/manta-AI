# RAG Knowledge Base Directory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist a filename directory on each RAG knowledge base, update it incrementally after document upload/deletion, expose it in existing APIs, search it, and display it on knowledge-base cards.

**Architecture:** Extend the existing knowledge-base JSON model with `directory: string[]`. Keep incremental add/remove operations inside the knowledge-base store so each mutation reads the latest persisted object, then call those operations from the existing upload/delete route after SQLite succeeds. The frontend consumes the existing API shape and renders a compact three-entry preview.

**Tech Stack:** TypeScript, Fastify, better-sqlite3, React, Zustand, Vitest, pnpm.

## Global Constraints

- Do not generate document summaries or call an LLM.
- Do not add a new locate/search endpoint; extend the existing knowledge-base list search.
- Upload appends one filename; deletion removes one matching filename so duplicate names remain one-per-document.
- Preserve unrelated working-tree changes.
- Do not commit, push, create a PR, or deploy without explicit user authorization.

---

### Task 1: Persist and search the knowledge-base directory

**Files:**
- Create: `packages/backend/src/core/storage/knowledge-base/store.test.ts`
- Modify: `packages/backend/src/core/storage/knowledge-base/store.ts`

**Interfaces:**
- Produces: `KnowledgeBase.directory: string[]`
- Produces: `recordKnowledgeBaseDocumentAdded(id: string, fileName: string, counts: { documentCount: number; chunkCount: number }): KnowledgeBase | null`
- Produces: `recordKnowledgeBaseDocumentRemoved(id: string, fileName: string, counts: { documentCount: number; chunkCount: number }): KnowledgeBase | null`

- [ ] **Step 1: Write failing store tests**

Add tests proving new/legacy knowledge bases expose `directory: []`, additions append names, removal deletes only the first duplicate, and `listKnowledgeBases(search)` matches directory filenames.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm --filter @manta/backend exec vitest run src/core/storage/knowledge-base/store.test.ts`

Expected: FAIL because `directory` and the record functions do not exist.

- [ ] **Step 3: Implement the minimal store behavior**

Add `directory` to the model and default config, normalize legacy reads with `directory ?? []`, include directory names in list filtering, and implement add/remove operations by reading the latest object, updating counts/directory/timestamp, and persisting once.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `pnpm --filter @manta/backend exec vitest run src/core/storage/knowledge-base/store.test.ts`

Expected: PASS.

### Task 2: Wire incremental updates into document mutations

**Files:**
- Create: `packages/backend/src/routes/rag-directory.test.ts`
- Create: `packages/backend/src/routes/rag-directory.ts`
- Modify: `packages/backend/src/routes/rag.ts`

**Interfaces:**
- Consumes: `recordKnowledgeBaseDocumentAdded` and `recordKnowledgeBaseDocumentRemoved` from Task 1.
- Produces: upload and deletion routes that update counts and directory in one knowledge-base-store mutation.

- [ ] **Step 1: Write failing route-source behavior tests**

Add focused tests for exported mutation helpers or route-injected store functions, proving upload passes the uploaded filename and deletion reads the document name before removing the SQLite row, then records one removal.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm --filter @manta/backend exec vitest run src/routes/rag-directory.test.ts`

Expected: FAIL because the route still calls generic `updateKnowledgeBase` for counts only.

- [ ] **Step 3: Implement the route wiring**

Replace upload's count-only update with `recordKnowledgeBaseDocumentAdded`. In deletion, load and validate the document before removal, then call `recordKnowledgeBaseDocumentRemoved` with the document name and refreshed counts.

- [ ] **Step 4: Run backend focused tests and typecheck**

Run:

```bash
pnpm --filter @manta/backend exec vitest run src/core/storage/knowledge-base/store.test.ts src/routes/rag-directory.test.ts
pnpm --filter @manta/backend typecheck
```

Expected: both commands PASS.

### Task 3: Render the directory on knowledge-base cards

**Files:**
- Create: `packages/frontend/src/pages/rag/directory-preview.test.ts`
- Create: `packages/frontend/src/pages/rag/directory-preview.ts`
- Modify: `packages/frontend/src/stores/rag-store.ts`
- Modify: `packages/frontend/src/pages/rag/page.tsx`

**Interfaces:**
- Consumes: `KnowledgeBase.directory` returned by existing APIs.
- Produces: `getKnowledgeBaseDirectoryPreview(directory: string[], limit?: number): { visible: string[]; remaining: number }`.

- [ ] **Step 1: Write failing preview tests**

Test empty directories, the first three filenames, and the remaining count while preserving duplicates and order.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm --filter @manta/frontend exec vitest run src/pages/rag/directory-preview.test.ts`

Expected: FAIL because the preview helper does not exist.

- [ ] **Step 3: Implement the helper, types, and card UI**

Add `directory: string[]` to `KnowledgeBaseSummary`; render a “目录” section with up to three truncated filenames, `title` attributes, “还有 N 个文档”, and “暂无文档”.

- [ ] **Step 4: Run frontend focused tests and typecheck**

Run:

```bash
pnpm --filter @manta/frontend exec vitest run src/pages/rag/directory-preview.test.ts
pnpm --filter @manta/frontend typecheck
```

Expected: the focused test passes. Typecheck must pass except for any explicitly documented pre-existing unrelated failure.

### Task 4: Final verification and diff review

**Files:**
- Modify only files listed above plus the approved spec and this plan.

- [ ] **Step 1: Run relevant verification**

```bash
pnpm --filter @manta/backend exec vitest run src/core/storage/knowledge-base/store.test.ts src/routes/rag-directory.test.ts
pnpm --filter @manta/frontend exec vitest run src/pages/rag/directory-preview.test.ts
pnpm --filter @manta/backend typecheck
pnpm --filter @manta/frontend typecheck
```

- [ ] **Step 2: Inspect the final diff**

Run: `git diff --check && git diff -- packages/backend/src/core/storage/knowledge-base packages/backend/src/routes/rag.ts packages/backend/src/routes/rag-directory.test.ts packages/frontend/src/stores/rag-store.ts packages/frontend/src/pages/rag docs/superpowers/specs/2026-07-17-rag-knowledge-base-directory-design.md docs/superpowers/plans/2026-07-17-rag-knowledge-base-directory.md`

Verify incremental behavior, duplicate-name deletion, legacy compatibility, absence of LLM calls, and no unrelated edits.
