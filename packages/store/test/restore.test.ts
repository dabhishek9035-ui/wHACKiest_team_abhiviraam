// owner: M4 (D Venkata Abhishek, 1TD25CS079)
// purpose: continuity tests — buildRestoreView (A13) and reconcileSideEffects with the
//          default local verifiers (A14): folder-existence verifies, URL/app launches
//          stay unknown and must be asked about, not retried.
// public interface it must expose: none (tests).
// consumed by: `pnpm --filter @pengu/store test`.
// TODO: none (implemented).

import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildRestoreView,
  createMemoryStore,
  createSqliteStore,
  defaultVerifiers,
  reconcileSideEffects,
  verifyWithDefaults,
  type PenguStore,
} from "../src/index.js";

let tmpRoot: string;
let store: PenguStore;

beforeEach(async () => {
  tmpRoot = mkdtempSync(join(tmpdir(), "pengu-restore-test-"));
  store = await createSqliteStore(join(tmpRoot, "pengu.db"));
});

afterEach(() => {
  store.close();
  try {
    rmSync(tmpRoot, { recursive: true, force: true });
  } catch {
    // best-effort cleanup on Windows file locks
  }
});

describe("buildRestoreView (A13)", () => {
  it("lists pending tasks with step statuses, pause reason, output refs and account context", () => {
    const task = store.createTask({
      request: "create invoices folder and list it",
      accountContext: { gmailAccount: "demo.user@gmail.com" },
    });
    const s1 = store.appendStep(task.id, {
      summary: "Create folder",
      tool: "fs_create_folder",
      server: "local",
      kind: "routine",
      status: "running",
    });
    const s2 = store.appendStep(task.id, { summary: "List folder contents", status: "planned" });
    store.updateStep(task.id, s1.id, { status: "done" });
    store.saveCheckpoint(task.id, {
      request: "create invoices folder and list it",
      steps: [
        { stepId: s1.id, summary: "Create folder", status: "done" },
        { stepId: s2.id, summary: "List folder contents", status: "pending" },
      ],
      outputRefs: { folderPath: join(tmpRoot, "invoices") },
      pauseReason: "terminated for restart test",
      accountContext: { gmailAccount: "demo.user@gmail.com" },
    });

    const view = buildRestoreView(store);
    expect(view.tasks).toHaveLength(1);
    const t = view.tasks[0] as (typeof view.tasks)[number];
    expect(t.taskId).toBe(task.id);
    expect(t.request).toBe("create invoices folder and list it");
    expect(t.pauseReason).toBe("terminated for restart test");
    expect(t.outputRefs?.folderPath).toBe(join(tmpRoot, "invoices"));
    expect(t.accountContext).toEqual({ gmailAccount: "demo.user@gmail.com" });
    expect(t.steps.map((s) => s.status)).toEqual(["done", "planned"]);
    expect(t.steps[0]?.tool).toBe("fs_create_folder");
  });

  it("excludes terminal tasks from the restore view", () => {
    const done = store.createTask({ request: "already finished" });
    store.setTaskStatus(done.id, "completed");
    const pending = store.createTask({ request: "still going" });
    const view = buildRestoreView(store);
    expect(view.tasks.map((t) => t.taskId)).toEqual([pending.id]);
  });

  it("falls back to the task-level account context when no checkpoint exists", () => {
    const task = store.createTask({ request: "no checkpoint", accountContext: { locale: "en-IN" } });
    const view = buildRestoreView(store);
    expect(view.tasks[0]?.accountContext).toEqual({ locale: "en-IN" });
  });
});

describe("default verifiers (A14)", () => {
  it("reports verified when the folder exists at the intent path", () => {
    const dir = join(tmpRoot, "exists");
    mkdirSync(dir, { recursive: true });
    expect(defaultVerifiers.fs_create_folder?.("fs_create_folder", { args: { path: dir } })).toBe(
      "verified",
    );
  });

  it("reports absent when the folder does not exist (safe to retry)", () => {
    expect(
      defaultVerifiers.fs_create_folder?.("fs_create_folder", {
        args: { path: join(tmpRoot, "missing") },
      }),
    ).toBe("absent");
  });

  it("reports unknown for invalid intent paths and for non-verifiable tools", () => {
    expect(defaultVerifiers.fs_create_folder?.("fs_create_folder", { args: {} })).toBe("unknown");
    expect(verifyWithDefaults("browser_open_url", { args: { url: "https://example.com" } })).toBe(
      "unknown",
    );
    expect(verifyWithDefaults("app_launch", { args: { appId: "notepad" } })).toBe("unknown");
    expect(verifyWithDefaults("unknown_tool", { args: {} })).toBe("unknown");
  });
});

describe("reconcileSideEffects (A14)", () => {
  it("completes a begun-but-not-completed folder creation that in fact happened", () => {
    const task = store.createTask({ request: "folder task" });
    const dir = join(tmpRoot, "reconciled");
    const key = `fs_create_folder:${dir}`;
    // Crash simulation: intent persisted, folder got created, result never recorded.
    store.beginSideEffect(key, { taskId: task.id, tool: "fs_create_folder", args: { path: dir } });
    mkdirSync(dir, { recursive: true });

    const items = reconcileSideEffects(store);
    expect(items).toHaveLength(1);
    expect(items[0]?.verdict).toBe("verified");
    expect(items[0]?.recommendation).toBe("trust");
    expect(items[0]?.action).toBe("completed_as_verified");

    const rec = store.getSideEffect(key);
    expect(rec?.state).toBe("completed");
    expect(rec?.result?.verified).toBe(true);
    // reconciling again is a no-op: no begun records remain
    expect(reconcileSideEffects(store)).toHaveLength(0);
  });

  it("leaves absent side effects open for safe retry", () => {
    const task = store.createTask({ request: "folder task 2" });
    const key = `fs_create_folder:${join(tmpRoot, "never-created")}`;
    store.beginSideEffect(key, { taskId: task.id, tool: "fs_create_folder", args: { path: join(tmpRoot, "never-created") } });

    const items = reconcileSideEffects(store);
    expect(items).toHaveLength(1);
    expect(items[0]?.verdict).toBe("absent");
    expect(items[0]?.recommendation).toBe("retry");
    expect(items[0]?.action).toBe("left_open");
    expect(store.getSideEffect(key)?.state).toBe("begun");
  });

  it("flags unknown (non-verifiable) side effects to ask the user, never auto-retry", () => {
    const task = store.createTask({ request: "open a page" });
    store.beginSideEffect(`browser_open_url:https://example.com`, {
      taskId: task.id,
      tool: "browser_open_url",
      args: { url: "https://example.com" },
    });
    const items = reconcileSideEffects(store);
    expect(items).toHaveLength(1);
    expect(items[0]?.verdict).toBe("unknown");
    expect(items[0]?.recommendation).toBe("ask_user");
    expect(items[0]?.action).toBe("left_open");
    expect(store.getSideEffect("browser_open_url:https://example.com")?.state).toBe("begun");
  });

  it("respects an injected verifier map (used by M1's resume flow)", () => {
    const task = store.createTask({ request: "gmail flow" });
    store.beginSideEffect("gmail_send_draft:d1", {
      taskId: task.id,
      tool: "gmail_send_draft",
      args: { draftId: "d1" },
    });
    const items = reconcileSideEffects(store, {
      verifiers: { gmail_send_draft: () => "unknown" },
    });
    expect(items[0]?.recommendation).toBe("ask_user");
  });
});

describe("in-memory store parity for continuity", () => {
  it("MemoryStore reconciles exactly like the SQLite store", () => {
    const mem = createMemoryStore();
    const dir = join(tmpRoot, "mem-verified");
    mem.beginSideEffect(`fs_create_folder:${dir}`, { tool: "fs_create_folder", args: { path: dir } });
    mkdirSync(dir, { recursive: true });
    const items = reconcileSideEffects(mem);
    expect(items[0]?.action).toBe("completed_as_verified");
    expect(mem.getSideEffect(`fs_create_folder:${dir}`)?.state).toBe("completed");
    mem.close();
  });
});
