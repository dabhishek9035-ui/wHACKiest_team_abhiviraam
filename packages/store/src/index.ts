// owner: M4 (D Venkata Abhishek, 1TD25CS079)
// purpose: public entry of @pengu/store — the PenguStore interface (contract 7.4)
//          plus factories for the SQLite store (persistence) and the in-memory store
//          (published early so M1 is never blocked), and the restore/continuity helpers.
// public interface it must expose: PenguStore, createSqliteStore(dbPath),
//          createMemoryStore(), record/restore types, buildRestoreView,
//          reconcileSideEffects, defaultVerifiers, SqlDatabase loader.
// consumed by: M1 runtime (services/agent), M4 scripts/tests.
// TODO: none (implemented).

import { loadSchemaSql, openSqliteDatabase, type SqlDatabase } from "./sqlitedb.js";
import { SqliteStore } from "./sqlite.js";
import { MemoryStore } from "./memory.js";
import type * as T from "./types.js";

export type * from "./types.js";
export { StoreError, PENDING_TASK_STATUSES, TERMINAL_TASK_STATUSES } from "./types.js";

export { openSqliteDatabase, loadSchemaSql } from "./sqlitedb.js";
export type { SqlDatabase } from "./sqlitedb.js";

export * from "./restore.js";

/**
 * The store API M1 calls for every task/step/checkpoint/approval/receipt/side-effect
 * (contract 7.4), plus QA extras used by restore and tests.
 * All writes are atomic; a kill mid-write cannot corrupt a checkpoint.
 */
export interface PenguStore {
  // tasks
  createTask(input: {
    id?: string;
    request: string;
    accountContext?: Record<string, unknown>;
    status?: T.TaskStatus;
  }): T.Task;
  getTask(taskId: string): T.Task | null;
  listTasks(filter?: { status?: T.TaskStatus | T.TaskStatus[] }): T.Task[];
  listPending(): T.Task[];
  setTaskStatus(taskId: string, status: T.TaskStatus, opts?: { pauseReason?: string }): T.Task;
  // steps
  appendStep(taskId: string, input: {
    id?: string;
    tool?: string;
    server?: string;
    kind?: T.StepKind;
    status?: T.StepStatus;
    summary: string;
  }): T.Step;
  updateStep(taskId: string, stepId: string, patch: { status?: T.StepStatus; summary?: string }): T.Step;
  listSteps(taskId: string): T.Step[];
  // checkpoints
  saveCheckpoint(taskId: string, state: T.CheckpointState): T.CheckpointState;
  loadCheckpoint(taskId: string): T.CheckpointState | null;
  // approvals
  recordApproval(input: T.ApprovalRecord): T.ApprovalRecord;
  getApproval(approvalId: string): T.ApprovalRecord | null;
  listApprovals(filter?: { taskId?: string; tool?: string }): T.ApprovalRecord[];
  // receipts
  recordReceipt(input: {
    id?: string;
    taskId?: string;
    tool: string;
    argsHash: string;
    outcome: T.ReceiptOutcome;
    detail?: Record<string, unknown>;
  }): T.ReceiptRecord;
  listReceipts(filter?: { taskId?: string; tool?: string }): T.ReceiptRecord[];
  // side effects (duplicate-safe external actions)
  beginSideEffect(key: string, intent: { taskId?: string; tool: string; args?: Record<string, unknown> }): T.SideEffectRecord;
  completeSideEffect(key: string, result: T.SideEffectResult): T.SideEffectRecord;
  getSideEffect(key: string): T.SideEffectRecord | null;
  listSideEffects(filter?: { state?: T.SideEffectState; taskId?: string }): T.SideEffectRecord[];
  // atomic multi-write helper (e.g. task + first step + checkpoint together)
  withTransaction<T>(fn: () => T): T;
  // release resources
  close(): void;
}

/** Create the persistent SQLite-backed store (contract 7.4 canonical). */
export async function createSqliteStore(dbPath: string): Promise<PenguStore> {
  const db: SqlDatabase = await openSqliteDatabase(dbPath);
  db.exec(loadSchemaSql());
  return new SqliteStore(db);
}

/** Create the in-memory store (same interface, used for tests and early integration). */
export function createMemoryStore(): PenguStore {
  return new MemoryStore();
}

// SQLite-backed domain modules are exported for advanced/operational use.
export { SqliteStore } from "./sqlite.js";
export { MemoryStore } from "./memory.js";
