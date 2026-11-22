// owner: M4 (D Venkata Abhishek, 1TD25CS079)
// purpose: PenguStore contract test suite — the SAME suite runs against the SQLite
//          backend and the in-memory backend so their semantics cannot drift.
// public interface it must expose: none (tests).
// consumed by: `pnpm --filter @pengu/store test`.
// TODO: none (implemented).

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createMemoryStore,
  createSqliteStore,
  StoreError,
  type PenguStore,
} from "../src/index.js";

const tmpDirs: string[] = [];

async function makeSqliteStore(): Promise<PenguStore> {
  const dir = mkdtempSync(join(tmpdir(), "pengu-store-test-"));
  tmpDirs.push(dir);
  return createSqliteStore(join(dir, "pengu.db"));
}

function makeMemoryStore(): PenguStore {
  return createMemoryStore();
}

afterEach(() => {
  while (tmpDirs.length) {
    const dir = tmpDirs.pop() as string;
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup on Windows file locks
    }
  }
});

describe.each([
  ["sqlite", async () => await makeSqliteStore()],
  ["memory", () => makeMemoryStore()],
])("PenguStore contract (%s)", (_name, makeStore) => {
  let store: PenguStore;

  beforeEach(async () => {
    store = await makeStore();
  });

  afterEach(() => {
    store.close();
  });

  it("creates a task with default status received and returns it via getTask", () => {
    const task = store.createTask({ request: "Create a folder for invoices" });
    expect(task.id).toBeTruthy();
    expect(task.status).toBe("received");
    const fetched = store.getTask(task.id);
    expect(fetched?.request).toBe("Create a folder for invoices");
    expect(fetched?.accountContext).toBeUndefined();
  });

  it("stores non-secret account context and rejects empty requests", () => {
    const task = store.createTask({
      request: "summarize my unread mail",
      accountContext: { gmailAccount: "demo.user@gmail.com" },
    });
    expect(store.getTask(task.id)?.accountContext).toEqual({ gmailAccount: "demo.user@gmail.com" });
    expect(() => store.createTask({ request: "" })).toThrow(StoreError);
  });

  it("walks the full task lifecycle through non-terminal and terminal states", () => {
    const task = store.createTask({ request: "demo" });
    for (const status of ["planned", "running", "awaiting_approval", "paused", "running"] as const) {
      store.setTaskStatus(task.id, status);
    }
    expect(store.getTask(task.id)?.status).toBe("running");
    store.setTaskStatus(task.id, "completed");
    expect(store.getTask(task.id)?.status).toBe("completed");
    // terminal task no longer counts as pending
    expect(store.listPending().find((t) => t.id === task.id)).toBeUndefined();
  });

  it("listPending returns unfinished tasks and listTasks filters by status", () => {
    const a = store.createTask({ request: "task a" });
    const b = store.createTask({ request: "task b" });
    store.setTaskStatus(a.id, "paused");
    store.setTaskStatus(b.id, "failed");
    const pending = store.listPending();
    expect(pending.map((t) => t.id)).toContain(a.id);
    expect(pending.map((t) => t.id)).not.toContain(b.id);
    const failed = store.listTasks({ status: "failed" });
    expect(failed.map((t) => t.id)).toEqual([b.id]);
    expect(store.getTask("does-not-exist")).toBeNull();
  });

  it("appends steps in order and updates them", () => {
    const task = store.createTask({ request: "plan with steps" });
    const s1 = store.appendStep(task.id, { summary: "Read the thread", kind: "read", server: "gmail" });
    const s2 = store.appendStep(task.id, {
      summary: "Create folder",
      tool: "fs_create_folder",
      kind: "routine",
      server: "local",
      status: "running",
    });
    expect(s2.idx).toBe(s1.idx + 1);
    const updated = store.updateStep(task.id, s2.id, { status: "done" });
    expect(updated.status).toBe("done");
    expect(updated.summary).toBe("Create folder");
    const steps = store.listSteps(task.id);
    expect(steps.map((s) => s.summary)).toEqual(["Read the thread", "Create folder"]);
    expect(() => store.appendStep("no-such-task", { summary: "x" })).toThrow(StoreError);
    expect(() => store.updateStep(task.id, "no-such-step", { status: "done" })).toThrow(StoreError);
  });

  it("round-trips a checkpoint with steps, output refs, pause reason and account context", () => {
    const task = store.createTask({
      request: "restart-safe task",
      accountContext: { gmailAccount: "demo.user@gmail.com" },
    });
    const state = {
      request: "restart-safe task",
      plan: { goal: "create folder and list it" },
      steps: [
        { stepId: "s1", summary: "Create folder", status: "done" as const },
        { stepId: "s2", summary: "List folder", status: "pending" as const },
        { stepId: "s3", summary: "Send report", status: "skipped" as const },
        { stepId: "s4", summary: "Broken step", status: "failed" as const },
      ],
      outputRefs: { folderPath: "C:\\Users\\demo\\Documents\\PenguSandbox\\invoices" },
      lastVerifiedState: { folderExists: true },
      pauseReason: "terminated for restart test",
      accountContext: { gmailAccount: "demo.user@gmail.com" },
    };
    store.saveCheckpoint(task.id, state);
    const loaded = store.loadCheckpoint(task.id);
    expect(loaded).not.toBeNull();
    expect(loaded?.steps).toHaveLength(4);
    expect(loaded?.outputRefs?.folderPath).toContain("PenguSandbox");
    expect(loaded?.pauseReason).toBe("terminated for restart test");
    expect(loaded?.accountContext).toEqual({ gmailAccount: "demo.user@gmail.com" });
    // upsert: saving again replaces the previous checkpoint atomically
    store.saveCheckpoint(task.id, { ...state, pauseReason: "second save" });
    expect(store.loadCheckpoint(task.id)?.pauseReason).toBe("second save");
    expect(() => store.saveCheckpoint("no-such-task", { steps: [] })).toThrow(StoreError);
    expect(() => store.saveCheckpoint(task.id, { steps: [{ stepId: "" }] })).toThrow(StoreError);
    expect(store.loadCheckpoint("no-such-task")).toBeNull();
  });

  it("records approvals, updates decisions by approvalId, and lists them", () => {
    const task = store.createTask({ request: "run restricted command" });
    const issued = new Date("2026-11-22T10:00:00Z").toISOString();
    const expires = new Date("2026-11-22T10:05:00Z").toISOString();
    const rec = store.recordApproval({
      approvalId: "a_test_1",
      taskId: task.id,
      tool: "shell_run_restricted",
      argsHash: "deadbeef",
      issuedAt: issued,
      expiresAt: expires,
      preview: { commandId: "sys.time", impact: "None — read-only query", reversible: true },
    });
    expect(rec.decision).toBeUndefined();
    const decided = store.recordApproval({
      approvalId: "a_test_1",
      taskId: task.id,
      tool: "shell_run_restricted",
      argsHash: "deadbeef",
      issuedAt: issued,
      expiresAt: expires,
      decision: "approved",
    });
    expect(decided.decision).toBe("approved");
    expect(decided.decidedAt).toBeTruthy();
    expect(decided.preview?.commandId).toBe("sys.time"); // earlier preview preserved
    expect(store.listApprovals({ taskId: task.id })).toHaveLength(1);
    expect(store.getApproval("a_test_1")?.argsHash).toBe("deadbeef");
    expect(store.getApproval("missing")).toBeNull();
  });

  it("records receipts for verified results", () => {
    const task = store.createTask({ request: "receipt demo" });
    const rec = store.recordReceipt({
      taskId: task.id,
      tool: "fs_create_folder",
      argsHash: "hash1",
      outcome: "ok",
      detail: { alreadyExisted: false },
    });
    expect(rec.outcome).toBe("ok");
    expect(store.listReceipts({ taskId: task.id })).toHaveLength(1);
    expect(store.listReceipts({ taskId: task.id })[0]?.detail).toEqual({ alreadyExisted: false });
  });

  it("handles side effects: begin before execute, complete after, idempotent begin", () => {
    const task = store.createTask({ request: "make a folder" });
    const key = "fs_create_folder:C:\\sandbox\\reports";
    const begun = store.beginSideEffect(key, {
      taskId: task.id,
      tool: "fs_create_folder",
      args: { path: "C:\\sandbox\\reports" },
    });
    expect(begun.state).toBe("begun");
    // begin again with same key: existing record returned unchanged (idempotent)
    const again = store.beginSideEffect(key, { tool: "fs_create_folder", args: { path: "CHANGED" } });
    expect(again.intent.args).toEqual({ path: "C:\\sandbox\\reports" });

    const done = store.completeSideEffect(key, {
      ok: true,
      outcome: "ok",
      summary: { alreadyExisted: false },
    });
    expect(done.state).toBe("completed");
    expect(done.result?.ok).toBe(true);
    // completing a completed record is a no-op
    const reDone = store.completeSideEffect(key, { ok: true, summary: { different: true } });
    expect(reDone.result?.summary).toEqual({ alreadyExisted: false });
    expect(store.getSideEffect(key)?.state).toBe("completed");
    expect(store.listSideEffects({ state: "begun" })).toHaveLength(0);
  });

  it("records failed side effects and refuses to complete an unknown key", () => {
    const key = "fs_create_folder:C:\\sandbox\\maybe";
    store.beginSideEffect(key, { tool: "fs_create_folder", args: { path: "C:\\sandbox\\maybe" } });
    const failed = store.completeSideEffect(key, { ok: false, outcome: "failed" });
    expect(failed.state).toBe("failed");
    expect(store.getSideEffect(key)?.result?.ok).toBe(false);
    expect(() => store.completeSideEffect("never-begun", { ok: true })).toThrow(StoreError);
  });

  it("rolls back everything when a transaction throws (atomicity)", () => {
    const before = store.listTasks().length;
    expect(() =>
      store.withTransaction(() => {
        store.createTask({ request: "inside transaction" });
        store.createTask({ request: "another inside transaction" });
        throw new Error("boom mid-transaction");
      }),
    ).toThrow("boom mid-transaction");
    expect(store.listTasks().length).toBe(before);
  });

  it("withTransaction applies all writes when it succeeds", () => {
    store.withTransaction(() => {
      const t = store.createTask({ request: "atomic task" });
      store.appendStep(t.id, { summary: "step inside transaction" });
      store.saveCheckpoint(t.id, { steps: [], pauseReason: "demo" });
    });
    expect(store.listTasks()).toHaveLength(1);
    expect(store.listSteps(store.listTasks()[0]?.id ?? "")).toHaveLength(1);
    expect(store.loadCheckpoint(store.listTasks()[0]?.id ?? "")?.pauseReason).toBe("demo");
  });
});
