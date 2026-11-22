// owner: M4 (D Venkata Abhishek, 1TD25CS079)
// purpose: SQLite implementation of PenguStore (contract 7.4). Composes the domain
//          repositories (tasks/steps/checkpoints/approvals/receipts/sideeffects) over
//          a SqlDatabase driver. Every write is atomic (driver-level transactions).
// public interface it must expose: class SqliteStore implements PenguStore.
// consumed by: index.ts factory createSqliteStore.
// TODO: none (implemented).

import type { PenguStore } from "./index.js";
import type { SqlDatabase } from "./sqlitedb.js";
import * as tasks from "./tasks.js";
import * as steps from "./steps.js";
import * as checkpoints from "./checkpoints.js";
import * as approvals from "./approvals.js";
import * as receipts from "./receipts.js";
import * as sideeffects from "./sideeffects.js";
import type * as T from "./types.js";

export class SqliteStore implements PenguStore {
  constructor(private readonly db: SqlDatabase) {}

  // tasks
  createTask(input: {
    id?: string;
    request: string;
    accountContext?: Record<string, unknown>;
    status?: T.TaskStatus;
  }): T.Task {
    return tasks.createTask(this.db, input);
  }
  getTask(taskId: string): T.Task | null {
    return tasks.getTask(this.db, taskId);
  }
  listTasks(filter?: { status?: T.TaskStatus | T.TaskStatus[] }): T.Task[] {
    return tasks.listTasks(this.db, filter);
  }
  listPending(): T.Task[] {
    return tasks.listPending(this.db);
  }
  setTaskStatus(taskId: string, status: T.TaskStatus, opts?: { pauseReason?: string }): T.Task {
    return tasks.setTaskStatus(this.db, taskId, status, opts);
  }

  // steps
  appendStep(
    taskId: string,
    input: {
      id?: string;
      tool?: string;
      server?: string;
      kind?: T.StepKind;
      status?: T.StepStatus;
      summary: string;
    },
  ): T.Step {
    return steps.appendStep(this.db, taskId, input);
  }
  updateStep(taskId: string, stepId: string, patch: { status?: T.StepStatus; summary?: string }): T.Step {
    return steps.updateStep(this.db, taskId, stepId, patch);
  }
  listSteps(taskId: string): T.Step[] {
    return steps.listSteps(this.db, taskId);
  }

  // checkpoints
  saveCheckpoint(taskId: string, state: T.CheckpointState): T.CheckpointState {
    return checkpoints.saveCheckpoint(this.db, taskId, state);
  }
  loadCheckpoint(taskId: string): T.CheckpointState | null {
    return checkpoints.loadCheckpoint(this.db, taskId);
  }

  // approvals
  recordApproval(input: T.ApprovalRecord): T.ApprovalRecord {
    return approvals.recordApproval(this.db, input);
  }
  getApproval(approvalId: string): T.ApprovalRecord | null {
    return approvals.getApproval(this.db, approvalId);
  }
  listApprovals(filter?: { taskId?: string; tool?: string }): T.ApprovalRecord[] {
    return approvals.listApprovals(this.db, filter);
  }

  // receipts
  recordReceipt(input: {
    id?: string;
    taskId?: string;
    tool: string;
    argsHash: string;
    outcome: T.ReceiptOutcome;
    detail?: Record<string, unknown>;
  }): T.ReceiptRecord {
    return receipts.recordReceipt(this.db, input);
  }
  listReceipts(filter?: { taskId?: string; tool?: string }): T.ReceiptRecord[] {
    return receipts.listReceipts(this.db, filter);
  }

  // side effects
  beginSideEffect(
    key: string,
    intent: { taskId?: string; tool: string; args?: Record<string, unknown> },
  ): T.SideEffectRecord {
    return sideeffects.beginSideEffect(this.db, key, intent);
  }
  completeSideEffect(key: string, result: T.SideEffectResult): T.SideEffectRecord {
    return sideeffects.completeSideEffect(this.db, key, result);
  }
  getSideEffect(key: string): T.SideEffectRecord | null {
    return sideeffects.getSideEffect(this.db, key);
  }
  listSideEffects(filter?: { state?: T.SideEffectState; taskId?: string }): T.SideEffectRecord[] {
    return sideeffects.listSideEffects(this.db, filter);
  }

  // atomic multi-write
  withTransaction<T>(fn: () => T): T {
    return this.db.transaction(fn);
  }

  close(): void {
    this.db.close();
  }
}
