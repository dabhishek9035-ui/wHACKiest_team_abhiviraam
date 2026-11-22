# @pengu/store

**Owner:** M4 — D Venkata Abhishek (`1TD25CS079`), project/team lead and integration owner.

**Purpose:** Pengu's local persistence (contract 7.4 of the global prompt): tasks, steps, checkpoints, approvals, receipts and side-effect intent/result records in **SQLite**, plus an **in-memory implementation of the same interface** published early so M1's runtime is never blocked, and the **restore/continuity helpers** (A13/A14).

## Public interface

```ts
import {
  createSqliteStore,   // (dbPath) => Promise<PenguStore>   — persistent SQLite
  createMemoryStore,   // () => PenguStore                  — same interface, process lifetime
  buildRestoreView,    // pending tasks + steps + pause reason + output refs (A13)
  reconcileSideEffects // begun-but-not-completed side effects -> verify / retry / ask_user (A14)
} from "@pengu/store";
```

`PenguStore` (contract 7.4): `createTask, getTask, listTasks, listPending, setTaskStatus, appendStep, updateStep, listSteps, saveCheckpoint, loadCheckpoint, recordApproval, getApproval, listApprovals, recordReceipt, listReceipts, beginSideEffect, completeSideEffect, getSideEffect, listSideEffects, withTransaction, close`.

Extras beyond the 7.4 list (`getApproval/listApprovals/listReceipts/listSideEffects/withTransaction/close`) are M4 QA/read helpers — additive only, announced to M1.

## Files

| File | What it is |
|---|---|
| `src/schema.sql` | Tables: tasks, steps, checkpoints, approvals, receipts, side_effects (copied to `dist/` at build) |
| `src/types.ts` | Record types, status unions, `PENDING_TASK_STATUSES`, `StoreError`, id/time helpers |
| `src/sqlitedb.ts` | `SqlDatabase` driver interface; better-sqlite3 adapter with `node:sqlite` fallback |
| `src/tasks.ts` | SQLite task repository |
| `src/steps.ts` | SQLite step repository |
| `src/checkpoints.ts` | SQLite checkpoint repository (single-row atomic upserts) |
| `src/approvals.ts` | SQLite approvals repository |
| `src/receipts.ts` | SQLite receipts repository |
| `src/sideeffects.ts` | SQLite side-effect repository (intent before execute, result after) |
| `src/sqlite.ts` | `SqliteStore` — composes the repos into `PenguStore` |
| `src/memory.ts` | `MemoryStore` — in-memory `PenguStore` with identical semantics |
| `src/restore.ts` | `buildRestoreView`, `reconcileSideEffects`, default local verifiers |
| `src/index.ts` | `PenguStore` interface, factories, re-exports |
| `test/store.test.ts` | Contract test suite run against **both** backends |
| `test/restore.test.ts` | Restore view + side-effect reconciliation tests |

Two additions beyond the canonical scaffold file list (`sqlitedb.ts`, `sqlite.ts`, `memory.ts`, `types.ts`) exist because the store needs a driver abstraction and the in-memory backend; both stay inside `packages/store` (M4-owned).

## Guarantees

- **Atomic writes.** Multi-write operations run in `withTransaction`; checkpoints and side-effect records are single-statement upserts, so a kill mid-write cannot corrupt them. SQLite runs in WAL mode with `foreign_keys = ON`.
- **Duplicate-safe side effects.** `beginSideEffect` persists intent *before* execution and is idempotent (returns the existing record). `completeSideEffect` requires a begun record; completing a completed record is a no-op. On resume, `reconcileSideEffects` verifies: `verified` -> completed with evidence, `absent` -> safe to retry, `unknown` -> `recommendation: "ask_user"` (never blindly retried).
- **No secrets.** The store never receives or stores API keys, OAuth tokens or approval secrets; `accountContext` holds non-secret context only.

## Driver note (honest-claims rule)

The canonical driver is **better-sqlite3**. Where its native prebuild cannot be loaded (e.g. a brand-new Node ABI without prebuilds), `openSqliteDatabase` falls back to Node's built-in **`node:sqlite`** module — still real SQLite file storage, no behaviour change. The active driver name is available via `openSqliteDatabase(...).driverName` and is printed to stderr when the fallback engages. M1 may amend the stack decision in `docs/DECISIONS.md`.

## How it is "done" (Definition of Done)

- [x] `schema.sql` defines the six tables with statuses per contract 7.4.
- [x] SQLite + in-memory implementations pass the **same** contract test suite (`pnpm --filter @pengu/store test`).
- [x] `buildRestoreView` returns the minimum `task.list.tasks[]` payload for the restore UI.
- [x] `reconcileSideEffects` implements verify/trust, safe-retry and ask-user paths (A14).
- [x] No secrets ever stored; nothing outside `packages/store` is touched.

Advances acceptance IDs: **A12, A13, A14** (store halves). Run evidence: `pnpm --filter @pengu/store test`.
