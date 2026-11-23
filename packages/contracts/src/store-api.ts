/**
 * owner: M1 (Ronit Kapar)
 * purpose: Frozen Store API contract implemented by packages/store (M4) and called by services/agent (M1) (Section 7.4).
 */

import type { ApprovalDecision, ApprovalPreview } from "./approval.js";
import type { StepKind, StepStatus, TaskSummaryItem } from "./events.js";

export type TaskState =
  | "received"
  | "planned"
  | "running"
  | "awaiting_approval"
  | "paused"
  | "completed"
  | "partial"
  | "failed"
  | "cancelled";

export interface TaskRecord {
  taskId: string;
  request: string;
  source: "text" | "voice";
  status: TaskState;
  pauseReason?: string;
  summary?: string;
  unresolved?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface StepRecord {
  stepId: string;
  taskId: string;
  tool: string;
  server: string;
  kind: StepKind;
  status: StepStatus;
  summary: string;
  args?: Record<string, unknown>;
  sideEffectKey?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CheckpointStepSnapshot {
  stepId: string;
  tool: string;
  server: string;
  kind: StepKind;
  status: StepStatus;
  summary: string;
  args?: Record<string, unknown>;
  sideEffectKey?: string;
}

export interface CheckpointState {
  request: string;
  plan: string[];
  steps: CheckpointStepSnapshot[];
  outputRefs: Record<string, string>;
  lastVerifiedState: string;
  pauseReason?: string;
  accountContext?: {
    gmailAccount?: string;
    approvedRoots?: string[];
  };
  updatedAt: string;
}

export interface ApprovalRecord {
  approvalId: string;
  taskId: string;
  stepId: string;
  tool: string;
  argsHash: string;
  preview: ApprovalPreview;
  decision?: ApprovalDecision | "expired" | "invalidated";
  reason: string;
  expiresAt: string;
  createdAt: string;
  decidedAt?: string;
}

export interface ReceiptRecord {
  receiptId: string;
  taskId: string;
  stepId: string;
  tool: string;
  server: string;
  sideEffectKey?: string;
  ok: boolean;
  summary: string;
  outputRefs?: Record<string, string>;
  verifiedAt: string;
}

export type SideEffectStatus = "begun" | "completed" | "failed" | "unknown";

export interface SideEffectIntent {
  taskId: string;
  stepId: string;
  tool: string;
  server: string;
  argsHash: string;
  summary: string;
}

export interface SideEffectResult {
  status: "completed" | "failed" | "unknown";
  summary: string;
  outputRefs?: Record<string, string>;
  verifiedAt: string;
}

export interface SideEffectRecord {
  key: string;
  intent: SideEffectIntent;
  status: SideEffectStatus;
  result?: SideEffectResult;
  begunAt: string;
  completedAt?: string;
}

export interface StoreApi {
  createTask(input: {
    taskId: string;
    request: string;
    source: "text" | "voice";
  }): Promise<TaskRecord>;
  getTask(taskId: string): Promise<TaskRecord | null>;
  listTasks(filter?: { status?: TaskState }): Promise<TaskSummaryItem[]>;
  listPending(): Promise<TaskSummaryItem[]>;
  appendStep(
    step: Omit<StepRecord, "createdAt" | "updatedAt">
  ): Promise<StepRecord>;
  updateStep(
    stepId: string,
    patch: Partial<Pick<StepRecord, "status" | "summary" | "sideEffectKey">>
  ): Promise<StepRecord | null>;
  saveCheckpoint(taskId: string, state: CheckpointState): Promise<void>;
  loadCheckpoint(taskId: string): Promise<CheckpointState | null>;
  recordApproval(record: ApprovalRecord): Promise<void>;
  recordReceipt(record: ReceiptRecord): Promise<void>;
  beginSideEffect(
    key: string,
    intent: SideEffectIntent
  ): Promise<SideEffectRecord>;
  completeSideEffect(
    key: string,
    result: SideEffectResult
  ): Promise<SideEffectRecord | null>;
  getSideEffect(key: string): Promise<SideEffectRecord | null>;
  setTaskStatus(
    taskId: string,
    status: TaskState,
    options?: { pauseReason?: string; summary?: string; unresolved?: string[] }
  ): Promise<void>;
}
