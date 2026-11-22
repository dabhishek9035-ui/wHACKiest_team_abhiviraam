// owner: M4 (D Venkata Abhishek, 1TD25CS079)
// purpose: in-memory implementation of PenguStore — same interface and same
//          semantics as the SQLite store, published early so M1 can integrate
//          before SQLite is wired, and used heavily by tests. Data lives for the
//          process lifetime only (no persistence across restarts).
// public interface it must expose: class MemoryStore implements PenguStore.
// consumed by: index.ts factory createMemoryStore; tests.
// TODO: none (implemented).

import type { PenguStore } from "./index.js";
import type * as T from "./types.js";
import { StoreError, newId, nowIso, PENDING_TASK_STATUSES } from "./types.js";

interface StepEntry extends T.Step {}
interface SideEffectEntry extends T.SideEffectRecord {}

export class MemoryStore implements PenguStore {
  private tasksById = new Map<string, T.Task>();
  private stepsByTask = new Map<string, StepEntry[]>();
  private checkpoints = new Map<string, T.CheckpointState>();
  private approvalsById = new Map<string, T.ApprovalRecord>();
  private receipts: T.ReceiptRecord[] = [];
  private sideEffectsByKey = new Map<string, SideEffectEntry>();

  createTask(input: {
    id?: string;
    request: string;
    accountContext?: Record<string, unknown>;
    status?: T.TaskStatus;
  }): T.Task {
    if (!input.request || typeof input.request !== "string") {
      throw new StoreError("invalid_input", "createTask: request must be a non-empty string");
    }
    const now = nowIso();
    const task: T.Task = {
      id: input.id ?? newId("t"),
      request: input.request,
      status: input.status ?? "received",
      createdAt: now,
      updatedAt: now,
    };
    if (input.accountContext) task.accountContext = { ...input.accountContext };
    this.tasksById.set(task.id, task);
    return { ...task, accountContext: task.accountContext ? { ...task.accountContext } : undefined };
  }

  getTask(taskId: string): T.Task | null {
    const task = this.tasksById.get(taskId);
    return task ? this.cloneTask(task) : null;
  }

  listTasks(filter?: { status?: T.TaskStatus | T.TaskStatus[] }): T.Task[] {
    let tasks = [...this.tasksById.values()].sort(
      (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
    );
    if (filter?.status) {
      const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
      tasks = tasks.filter((t) => statuses.includes(t.status));
    }
    return tasks.map((t) => this.cloneTask(t));
  }

  listPending(): T.Task[] {
    return [...this.tasksById.values()]
      .filter((t) => (PENDING_TASK_STATUSES as readonly string[]).includes(t.status))
      .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt) || a.id.localeCompare(b.id))
      .map((t) => this.cloneTask(t));
  }

  setTaskStatus(taskId: string, status: T.TaskStatus, opts?: { pauseReason?: string }): T.Task {
    const task = this.tasksById.get(taskId);
    if (!task) throw new StoreError("task_not_found", `task not found: ${taskId}`);
    task.status = status;
    task.updatedAt = nowIso();
    if (opts?.pauseReason) {
      const cp = this.checkpoints.get(taskId);
      if (cp) {
        cp.pauseReason = opts.pauseReason;
        this.checkpoints.set(taskId, cp);
      }
    }
    return this.cloneTask(task);
  }

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
    const task = this.tasksById.get(taskId);
    if (!task) throw new StoreError("task_not_found", `task not found: ${taskId}`);
    if (!input.summary || typeof input.summary !== "string") {
      throw new StoreError("invalid_input", "appendStep: summary must be a non-empty string");
    }
    const list = this.stepsByTask.get(taskId) ?? [];
    const now = nowIso();
    const step: T.Step = {
      id: input.id ?? newId("s"),
      taskId,
      idx: list.length,
      status: input.status ?? "planned",
      summary: input.summary,
      createdAt: now,
      updatedAt: now,
    };
    if (input.tool !== undefined) step.tool = input.tool;
    if (input.server !== undefined) step.server = input.server;
    if (input.kind !== undefined) step.kind = input.kind;
    list.push(step);
    this.stepsByTask.set(taskId, list);
    task.updatedAt = now;
    return this.cloneStep(step);
  }

  updateStep(taskId: string, stepId: string, patch: { status?: T.StepStatus; summary?: string }): T.Step {
    const list = this.stepsByTask.get(taskId) ?? [];
    const step = list.find((s) => s.id === stepId);
    if (!step) {
      throw new StoreError("step_not_found", `step not found: ${stepId} (task ${taskId})`);
    }
    if (patch.status !== undefined) step.status = patch.status;
    if (patch.summary !== undefined) step.summary = patch.summary;
    step.updatedAt = nowIso();
    const task = this.tasksById.get(taskId);
    if (task) task.updatedAt = step.updatedAt;
    return this.cloneStep(step);
  }

  listSteps(taskId: string): T.Step[] {
    const list = this.stepsByTask.get(taskId) ?? [];
    return [...list].sort((a, b) => a.idx - b.idx).map((s) => this.cloneStep(s));
  }

  saveCheckpoint(taskId: string, state: T.CheckpointState): T.CheckpointState {
    const task = this.tasksById.get(taskId);
    if (!task) throw new StoreError("task_not_found", `task not found: ${taskId}`);
    if (!Array.isArray(state.steps)) {
      throw new StoreError("invalid_input", "saveCheckpoint: state.steps must be an array");
    }
    for (const s of state.steps) {
      if (!s || typeof s.stepId !== "string" || !s.summary) {
        throw new StoreError("invalid_input", "saveCheckpoint: each step needs stepId and summary");
      }
    }
    const copy = this.cloneCheckpoint(state);
    this.checkpoints.set(taskId, copy);
    return this.cloneCheckpoint(copy);
  }

  loadCheckpoint(taskId: string): T.CheckpointState | null {
    const cp = this.checkpoints.get(taskId);
    return cp ? this.cloneCheckpoint(cp) : null;
  }

  recordApproval(input: T.ApprovalRecord): T.ApprovalRecord {
    if (!input.approvalId || !input.tool || !input.argsHash) {
      throw new Error("recordApproval: approvalId, tool and argsHash are required");
    }
    const existing = this.approvalsById.get(input.approvalId);
    const merged: T.ApprovalRecord = {
      ...(existing ?? input),
      ...input,
      decidedAt: input.decidedAt ?? existing?.decidedAt ?? (input.decision ? nowIso() : undefined),
      preview: input.preview ?? existing?.preview,
    };
    this.approvalsById.set(input.approvalId, merged);
    return { ...merged, preview: merged.preview ? { ...merged.preview } : undefined };
  }

  getApproval(approvalId: string): T.ApprovalRecord | null {
    const a = this.approvalsById.get(approvalId);
    return a ? { ...a, preview: a.preview ? { ...a.preview } : undefined } : null;
  }

  listApprovals(filter?: { taskId?: string; tool?: string }): T.ApprovalRecord[] {
    let list = [...this.approvalsById.values()].sort(
      (a, b) => a.issuedAt.localeCompare(b.issuedAt) || a.approvalId.localeCompare(b.approvalId),
    );
    if (filter?.taskId) list = list.filter((a) => a.taskId === filter.taskId);
    if (filter?.tool) list = list.filter((a) => a.tool === filter.tool);
    return list.map((a) => ({ ...a, preview: a.preview ? { ...a.preview } : undefined }));
  }

  recordReceipt(input: {
    id?: string;
    taskId?: string;
    tool: string;
    argsHash: string;
    outcome: T.ReceiptOutcome;
    detail?: Record<string, unknown>;
  }): T.ReceiptRecord {
    if (!input.tool || !input.argsHash || !input.outcome) {
      throw new Error("recordReceipt: tool, argsHash and outcome are required");
    }
    const rec: T.ReceiptRecord = {
      id: input.id ?? newId("r"),
      tool: input.tool,
      argsHash: input.argsHash,
      outcome: input.outcome,
      createdAt: nowIso(),
    };
    if (input.taskId !== undefined) rec.taskId = input.taskId;
    if (input.detail !== undefined) rec.detail = { ...input.detail };
    this.receipts.push(rec);
    return { ...rec, detail: rec.detail ? { ...rec.detail } : undefined };
  }

  listReceipts(filter?: { taskId?: string; tool?: string }): T.ReceiptRecord[] {
    let list = [...this.receipts].sort(
      (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
    );
    if (filter?.taskId) list = list.filter((r) => r.taskId === filter.taskId);
    if (filter?.tool) list = list.filter((r) => r.tool === filter.tool);
    return list.map((r) => ({ ...r, detail: r.detail ? { ...r.detail } : undefined }));
  }

  beginSideEffect(
    key: string,
    intent: { taskId?: string; tool: string; args?: Record<string, unknown> },
  ): T.SideEffectRecord {
    if (!key || !intent.tool) {
      throw new StoreError("invalid_input", "beginSideEffect: key and tool are required");
    }
    const existing = this.sideEffectsByKey.get(key);
    if (existing) return this.cloneSideEffect(existing);
    const now = nowIso();
    const rec: T.SideEffectRecord = {
      key,
      tool: intent.tool,
      intent: { args: { ...(intent.args ?? {}) } },
      state: "begun",
      createdAt: now,
      updatedAt: now,
    };
    if (intent.taskId !== undefined) rec.taskId = intent.taskId;
    this.sideEffectsByKey.set(key, rec);
    return this.cloneSideEffect(rec);
  }

  completeSideEffect(key: string, result: T.SideEffectResult): T.SideEffectRecord {
    const rec = this.sideEffectsByKey.get(key);
    if (!rec) {
      throw new StoreError(
        "side_effect_missing",
        `completeSideEffect: no intent record for key ${key} (begin must run before execute)`,
      );
    }
    if (rec.state === "completed") return this.cloneSideEffect(rec); // idempotent
    const outcome: "ok" | "failed" =
      result.outcome === "failed" || result.ok === false ? "failed" : "ok";
    rec.state = outcome === "failed" ? "failed" : "completed";
    rec.updatedAt = nowIso();
    rec.result = {
      ok: result.ok ?? outcome === "ok",
      verified: result.verified,
      outcome,
      summary: { ...(result.summary ?? {}) },
    };
    return this.cloneSideEffect(rec);
  }

  getSideEffect(key: string): T.SideEffectRecord | null {
    const rec = this.sideEffectsByKey.get(key);
    return rec ? this.cloneSideEffect(rec) : null;
  }

  listSideEffects(filter?: { state?: T.SideEffectState; taskId?: string }): T.SideEffectRecord[] {
    let list = [...this.sideEffectsByKey.values()].sort(
      (a, b) => a.createdAt.localeCompare(b.createdAt) || a.key.localeCompare(b.key),
    );
    if (filter?.state) list = list.filter((s) => s.state === filter.state);
    if (filter?.taskId) list = list.filter((s) => s.taskId === filter.taskId);
    return list.map((s) => this.cloneSideEffect(s));
  }

  /**
   * Atomicity for the memory store: state is snapshotted before fn runs and restored
   * if fn throws, mirroring SQLite transaction rollback semantics.
   */
  withTransaction<T>(fn: () => T): T {
    const snapshot = this.serializeState();
    try {
      return fn();
    } catch (err) {
      this.restoreState(snapshot);
      throw err;
    }
  }

  private serializeState(): string {
    return JSON.stringify({
      tasks: [...this.tasksById],
      steps: [...this.stepsByTask],
      checkpoints: [...this.checkpoints],
      approvals: [...this.approvalsById],
      receipts: this.receipts,
      sideEffects: [...this.sideEffectsByKey],
    });
  }

  private restoreState(snapshot: string): void {
    const d = JSON.parse(snapshot) as {
      tasks: [string, T.Task][];
      steps: [string, T.Step[]][];
      checkpoints: [string, T.CheckpointState][];
      approvals: [string, T.ApprovalRecord][];
      receipts: T.ReceiptRecord[];
      sideEffects: [string, T.SideEffectRecord][];
    };
    this.tasksById = new Map(d.tasks);
    this.stepsByTask = new Map(d.steps);
    this.checkpoints = new Map(d.checkpoints);
    this.approvalsById = new Map(d.approvals);
    this.receipts = d.receipts;
    this.sideEffectsByKey = new Map(d.sideEffects);
  }

  close(): void {
    // nothing to release for the in-memory store
  }

  // ---- deep-copy helpers so callers cannot mutate internal state ----
  private cloneTask(t: T.Task): T.Task {
    const copy: T.Task = { ...t };
    if (t.accountContext) copy.accountContext = { ...t.accountContext };
    return copy;
  }
  private cloneStep(s: T.Step): T.Step {
    return { ...s };
  }
  private cloneCheckpoint(c: T.CheckpointState): T.CheckpointState {
    return {
      ...c,
      steps: c.steps.map((s) => ({ ...s })),
      plan: c.plan ? { ...c.plan } : undefined,
      outputRefs: c.outputRefs ? { ...c.outputRefs } : undefined,
      lastVerifiedState: c.lastVerifiedState ? { ...c.lastVerifiedState } : undefined,
      accountContext: c.accountContext ? { ...c.accountContext } : undefined,
    };
  }
  private cloneSideEffect(s: T.SideEffectRecord): T.SideEffectRecord {
    const copy: T.SideEffectRecord = { ...s, intent: { ...s.intent } };
    if (s.result) copy.result = { ...s.result, summary: { ...(s.result.summary ?? {}) } };
    return copy;
  }
}
