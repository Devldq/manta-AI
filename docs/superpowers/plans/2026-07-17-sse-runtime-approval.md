# SSE Runtime Approval Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make runtime file and shell approvals work end-to-end over the existing SSE downlink and REST response API, including recovery after a frontend page refresh.

**Architecture:** Keep `ApprovalManager` as the single authoritative in-process pending approval store. All REST and SSE routes use that manager; the frontend first loads the pending snapshot, then consumes SSE updates and posts decisions through REST. Event merging is keyed by approval ID so snapshot/SSE reconnect replay is idempotent.

**Tech Stack:** TypeScript, Fastify, React 19, EventSource, Vitest.

## Global Constraints

- Keep SSE plus REST; do not introduce WebSocket or a new dependency.
- Preserve the existing file and shell tool approval call sites.
- Do not commit, push, create a PR, or deploy.
- Pending approvals survive renderer refreshes, but not a backend process restart because the store remains in memory.

---

### Task 1: Single authoritative approval store and REST API

**Files:**
- Modify: `packages/backend/src/core/security/ApprovalManager.ts`
- Modify: `packages/backend/src/routes/approval.ts`
- Create: `packages/backend/src/routes/approval.test.ts`

**Interfaces:**
- Consumes: existing `approvalManager.createRequest()`, `waitForResponse()`, and SSE broadcast behavior.
- Produces: REST creation, lookup, pending-list, and decision endpoints backed exclusively by `approvalManager`.

- [ ] **Step 1: Write failing route tests**

Test that a request created directly through `approvalManager` appears in `GET /api/approval/pending`, and that `POST /api/approval/:id/respond` resolves `waitForResponse(id)`.

- [ ] **Step 2: Run the focused backend test and verify RED**

Run: `pnpm --filter @manta/backend exec vitest run src/routes/approval.test.ts`

Expected: the pending endpoint does not see manager-created requests and the response endpoint returns 404.

- [ ] **Step 3: Replace the route-local Map with ApprovalManager calls**

Validate approval types and actions, use `createRequest`, `getRequest`, `getPendingRequests`, and `respondToRequest`, and return consistent request projections.

- [ ] **Step 4: Run the focused backend test and verify GREEN**

Run: `pnpm --filter @manta/backend exec vitest run src/routes/approval.test.ts`

Expected: all approval route tests pass.

### Task 2: Idempotent renderer refresh and SSE recovery

**Files:**
- Create: `packages/frontend/src/components/approval-state.ts`
- Create: `packages/frontend/src/components/approval-state.test.ts`
- Modify: `packages/frontend/src/components/ApprovalDialog.tsx`

**Interfaces:**
- Consumes: `GET /api/approval/pending`, `GET /api/approval/sse`, and `POST /api/approval/:id/respond`.
- Produces: `mergePendingApproval`, `removePendingApproval`, and a dialog queue restored from the REST snapshot then updated by SSE.

- [ ] **Step 1: Write failing state tests**

Test that replaying the same request ID does not duplicate it, a newer request is appended, and a response removes the matching ID.

- [ ] **Step 2: Run the focused frontend test and verify RED**

Run: `pnpm --filter @manta/frontend exec vitest run src/components/approval-state.test.ts`

Expected: module resolution fails because the state helpers do not exist.

- [ ] **Step 3: Implement minimal immutable state helpers**

Use approval ID as the identity key. Preserve queue order while replacing a replayed request with its latest representation.

- [ ] **Step 4: Run the focused frontend test and verify GREEN**

Run: `pnpm --filter @manta/frontend exec vitest run src/components/approval-state.test.ts`

Expected: all approval-state tests pass.

- [ ] **Step 5: Update ApprovalDialog**

Load the pending snapshot on mount, create one stable `EventSource`, rely on native EventSource reconnection, merge all replayed events idempotently, and derive the current dialog from the first queued request. Keep REST POST for approve/deny.

- [ ] **Step 6: Run frontend typecheck and focused tests**

Run: `pnpm --filter @manta/frontend typecheck`

Run: `pnpm --filter @manta/frontend exec vitest run src/components/approval-state.test.ts`

Expected: both commands pass.

### Task 3: Regression verification

**Files:**
- Review only: all files changed by Tasks 1–2.

**Interfaces:**
- Consumes: completed backend and frontend approval implementation.
- Produces: verified approval request → refresh/reconnect → decision → waiting tool continuation behavior.

- [ ] **Step 1: Run backend approval tests and typecheck**

Run: `pnpm --filter @manta/backend exec vitest run src/routes/approval.test.ts`

Run: `pnpm --filter @manta/backend typecheck`

- [ ] **Step 2: Run frontend approval tests and typecheck**

Run: `pnpm --filter @manta/frontend exec vitest run src/components/approval-state.test.ts`

Run: `pnpm --filter @manta/frontend typecheck`

- [ ] **Step 3: Inspect the final diff**

Run: `git diff --check`

Run: `git diff -- packages/backend/src/core/security/ApprovalManager.ts packages/backend/src/routes/approval.ts packages/backend/src/routes/approval.test.ts packages/frontend/src/components/approval-state.ts packages/frontend/src/components/approval-state.test.ts packages/frontend/src/components/ApprovalDialog.tsx`

Expected: no unrelated changes, duplicate stores, unsafe action coercion, or reconnect timer leaks.
