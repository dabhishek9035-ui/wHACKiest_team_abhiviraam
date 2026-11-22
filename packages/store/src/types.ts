// owner: M4 (D Venkata Abhishek, 1TD25CS079)
// purpose: shared record types, statuses, id/time helpers and error type for the
//          Pengu store (contract 7.4). Used by both the SQLite and the in-memory
//          implementations so their semantics stay identical.
// public interface it must expose: record types + task/step status unions +
//          PENDING_TASK_STATUSES + StoreError + newId/nowIso helpers.
// consumed by: every other module in packages/store; M1 runtime.
// TODO: none (implemented).

import { randomUUID } from "node:crypto";

/** Task lifecycle states (contract 7.4). Terminal: completed|partial|failed|cancelled. */
export type TaskStatus =
  | "received"
  | "planned"
  | "running"
  | "awaiting_approval"
  | "paused"
  | "completed"
  | "partial"
  | "failed"
  | "cancelled";

export const TERMINAL_TASK_STATUSES: readonly TaskStatus[] = [
  "completed",
  "partial",
  "failed",
  "cancelled",
];

/** Non-terminal tasks are the ones the restore UI offers to resume (A13). */
export const PENDING_TASK_STATUSES: readonly TaskStatus[] = [
  "received",
  "planned",
  "running",
  "awaiting_approval",
  "paused",
];

/** Step lifecycle states (contract 7.1 task.step). */
export type StepStatus = "planned" | "running" | "awaiting_approval" | "done" | "failed" | "skipped";

/** Policy risk classes as seen on steps (contract 7.2, lowercase on steps). */
export type StepKind = "read" | "routine" | "consequential";

export interface Task {
  id: string;
  request: string;
  status: TaskStatus;
  /** Non-secret account/integration context (e.g. { gmailAccount: "user@gmail.com" }). */
  accountContext?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface Step {
  id: string;
  taskId: string;
  idx: number;
  tool?: string;
  server?: string;
  kind?: StepKind;
  status: StepStatus;
  summary: string;
  createdAt: string;
  updatedAt: string;
}

/** One step as captured in a checkpoint (done/pending/failed/skipped per 7.4). */
export interface CheckpointStep {
  stepId: string;
  summary: string;
  status: "done" | "pending" | "failed" | "skipped";
}

/** Checkpoint payload (contract 7.4). Never contains secrets. */
export interface CheckpointState {
  request?: string;
  plan?: Record<string, unknown>;
  steps: CheckpointStep[];
  /** Output references such as draftId, folder path. */
  outputRefs?: Record<string, string>;
  lastVerifiedState?: Record<string, unknown>;
  pauseReason?: string;
  accountContext?: Record<string, unknown>;
}

export type ApprovalDecision = "approved" | "denied" | "expired" | "invalidated";

export interface ApprovalRecord {
  approvalId: string;
  taskId?: string;
  tool: string;
  argsHash: string;
  /** JSON preview shown to the user (exact action; no secrets). */
  preview?: Record<string, unknown>;
  decision?: ApprovalDecision;
  issuedAt: string;
  expiresAt: string;
  decidedAt?: string;
}

export type ReceiptOutcome = "ok" | "failed" | "unknown";

export interface ReceiptRecord {
  id: string;
  taskId?: string;
  tool: string;
  argsHash: string;
  outcome: ReceiptOutcome;
  detail?: Record<string, unknown>;
  createdAt: string;
}

export type SideEffectState = "begun" | "completed" | "failed";

export interface SideEffectRecord {
  key: string;
  taskId?: string;
  tool: string;
  /** Resolved args at intent time (persisted BEFORE execution). */
  intent: Record<string, unknown>;
  /** Result summary (persisted AFTER execution). */
  result?: Record<string, unknown>;
  state: SideEffectState;
  createdAt: string;
  updatedAt: string;
}

export interface SideEffectResult {
  ok?: boolean;
  verified?: boolean;
  outcome?: ReceiptOutcome;
  summary?: Record<string, unknown>;
}

/** Store domain error with a stable code for callers to branch on. */
export class StoreError extends Error {
  constructor(
    public readonly code:
      | "task_not_found"
      | "step_not_found"
      | "checkpoint_missing"
      | "side_effect_missing"
      | "side_effect_failed"
      | "invalid_status"
      | "invalid_input",
    message: string,
  ) {
    super(message);
    this.name = "StoreError";
  }
}

let idCounter = 0;

/** Collision-safe id with a readable prefix, e.g. "t_...", "s_...". */
export function newId(prefix: string): string {
  idCounter = (idCounter + 1) % 1_000_000;
  return `${prefix}_${Date.now().toString(36)}_${idCounter.toString(36)}_${randomUUID().slice(0, 8)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function isTaskStatus(v: unknown): v is TaskStatus {
  return (
    typeof v === "string" &&
    PENDING_TASK_STATUSES.concat(TERMINAL_TASK_STATUSES).includes(v as TaskStatus)
  );
}
