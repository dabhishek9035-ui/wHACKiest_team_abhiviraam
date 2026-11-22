// owner: M4 (D Venkata Abhishek, 1TD25CS079)
// purpose: node harness for scripts/restart-test.ps1 (A13/A14). Phase A creates a
//          task, persists intent (beginSideEffect), performs the folder creation via
//          the Local MCP tool core, then deliberately does NOT complete the side
//          effect and idles — the PowerShell script force-kills it mid-task.
//          Phase B relaunches: opens the same SQLite store, asserts the unfinished
//          task reappears with correct state (A13), reconciles the begun-but-not-
//          completed side effect (folder exists => verified, no duplicate creation,
//          A14), resumes the remaining step and finishes the task honestly.
// public interface it must expose: CLI (--phase A|B --db <path> --sandbox <dir>).
// consumed by: scripts/restart-test.ps1.
// TODO: none (implemented).

import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createSqliteStore, buildRestoreView, reconcileSideEffects } from "../packages/store/dist/index.js";
import { createLocalServerCore } from "../mcp/local/dist/server.js";

const args = process.argv.slice(2);
function argValue(name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}
const phase = argValue("--phase");
const dbPath = argValue("--db");
const sandbox = argValue("--sandbox");
if (!phase || !dbPath || !sandbox) {
  console.error("usage: node restart-harness.mjs --phase A|B --db <path> --sandbox <dir>");
  process.exit(2);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");

function makeCore() {
  return createLocalServerCore({
    config: {
      fsRoots: [{ id: "sandbox", path: sandbox, description: "restart-test sandbox" }],
      defaultRootId: "sandbox",
      urlPolicy: { schemes: ["http:", "https:"] },
      chromePath: "",
      allowedApps: {},
    },
    allowlist: { defaults: { cwd: sandbox }, commands: [] },
    secret: undefined,
  });
}

function fail(phase, errors) {
  console.log(JSON.stringify({ phase, pass: false, failures: errors }, null, 2));
  console.log("RESTART_TEST_FAIL");
  process.exit(1);
}

if (phase === "A") {
  // Clean start: remove any previous DB/sandbox artifacts.
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      if (existsSync(dbPath + suffix)) rmSync(dbPath + suffix, { force: true });
    } catch {}
  }
  const target = path.join(sandbox, "reports");
  try {
    rmSync(target, { recursive: true, force: true });
  } catch {}

  const store = await createSqliteStore(dbPath);
  const core = makeCore();

  const task = store.createTask({
    request: "Create the invoices folder inside PenguSandbox and list it",
    accountContext: { source: "restart-test" },
  });
  store.setTaskStatus(task.id, "planned");
  const s1 = store.appendStep(task.id, {
    summary: "Create folder invoices (fs_create_folder)",
    tool: "fs_create_folder",
    server: "local",
    kind: "routine",
    status: "running",
  });
  const s2 = store.appendStep(task.id, {
    summary: "List folder contents (fs_list_dir)",
    tool: "fs_list_dir",
    server: "local",
    kind: "read",
    status: "planned",
  });
  store.setTaskStatus(task.id, "running");
  store.saveCheckpoint(task.id, {
    request: task.request,
    steps: [
      { stepId: s1.id, summary: s1.summary, status: "pending" },
      { stepId: s2.id, summary: s2.summary, status: "pending" },
    ],
    outputRefs: { folderPath: target },
    accountContext: { source: "restart-test" },
  });

  // Duplicate-safe ordering per rule 5: persist intent BEFORE executing.
  const key = `fs_create_folder:${target}`;
  store.beginSideEffect(key, { taskId: task.id, tool: "fs_create_folder", args: { path: target } });

  const res = await core.callTool("fs_create_folder", { path: target });
  if (!res.ok) fail("A", [`folder creation failed unexpectedly: ${JSON.stringify(res)}`]);
  store.recordReceipt({
    taskId: task.id,
    tool: "fs_create_folder",
    argsHash: "harness-phase-a",
    outcome: "ok",
    detail: { alreadyExisted: res.alreadyExisted === true },
  });
  store.updateStep(task.id, s1.id, { status: "done" });
  store.saveCheckpoint(task.id, {
    request: task.request,
    steps: [
      { stepId: s1.id, summary: s1.summary, status: "done" },
      { stepId: s2.id, summary: s2.summary, status: "pending" },
    ],
    outputRefs: { folderPath: target },
    accountContext: { source: "restart-test" },
  });

  // NOTE: we intentionally do NOT call completeSideEffect and do NOT finish the
  // task. The process now idles until the PowerShell script force-kills it
  // "mid-task" — the begun-but-not-completed side effect is the crash state.
  console.log(
    `PHASE_A_DONE taskId=${task.id} step1=${s1.id} step2=${s2.id} key=${key} folder=${target}`,
  );
  console.log(JSON.stringify({ phase: "A", taskId: task.id, key, folder: target }));
  setInterval(() => {}, 1000); // stay alive until killed
} else if (phase === "B") {
  const target = path.join(sandbox, "reports");
  const key = `fs_create_folder:${target}`;
  const errors = [];
  const store = await createSqliteStore(dbPath);
  const core = makeCore();

  // ---- A13: unfinished task reappears after the forced kill ----
  const task = store.getTask(argValue("--task-id") ?? "");
  if (!task) {
    // fall back: single-task store
    const pending = store.listPending();
    if (pending.length !== 1) {
      fail("B", [`expected exactly 1 pending task after relaunch, found ${pending.length}`]);
    }
  }
  const pendingTasks = store.listPending();
  const t = pendingTasks[0];
  if (!t) fail("B", ["no pending task found after relaunch (A13 FAILED)"]);
  if (t.status !== "running") {
    errors.push(`task status is '${t.status}', expected 'running' (non-terminal)`);
  }

  const view = buildRestoreView(store, { taskId: t.id });
  const restored = view.tasks[0];
  if (!restored) errors.push("restore view did not include the unfinished task");
  const statuses = (restored?.steps ?? []).map((s) => s.status);
  if (!(statuses.includes("done") && statuses.includes("planned"))) {
    errors.push(`restore view step statuses wrong: ${JSON.stringify(statuses)}`);
  }
  if (restored?.outputRefs?.folderPath !== target) {
    errors.push(`restore outputRefs.folderPath mismatch: ${JSON.stringify(restored?.outputRefs)}`);
  }

  // ---- A14: begun-but-not-completed side effect is verified, not repeated ----
  const se = store.getSideEffect(key);
  if (!se || se.state !== "begun") {
    errors.push(`side effect state after crash expected 'begun', got '${se?.state ?? "missing"}'`);
  }
  const items = reconcileSideEffects(store);
  const item = items.find((i) => i.key === key);
  if (!item) {
    errors.push("reconcile did not examine the begun side effect");
  } else if (item.verdict !== "verified" || item.recommendation !== "trust") {
    errors.push(`reconcile verdict unexpected: ${JSON.stringify(item)}`);
  }
  const seAfter = store.getSideEffect(key);
  if (seAfter?.state !== "completed" || seAfter?.result?.verified !== true) {
    errors.push(`side effect not completed-as-verified: ${JSON.stringify(seAfter)}`);
  }

  // No duplicate folder creation: exactly one 'reports' directory exists.
  let dirCount = 0;
  try {
    const entries = await core.callTool("fs_list_dir", { path: sandbox, limit: 500 });
    dirCount = (entries.entries ?? []).filter((e) => e.name === "reports" && e.type === "dir").length;
  } catch (err) {
    errors.push(`sandbox listing failed: ${String(err)}`);
  }
  if (dirCount !== 1) {
    errors.push(`found ${dirCount} 'reports' directories in sandbox, expected exactly 1 (no duplicates)`);
  }

  // ---- Resume the remaining step honestly ----
  const step2 = (restored?.steps ?? []).find((s) => s.status === "planned");
  if (step2) {
    const listRes = await core.callTool("fs_list_dir", { path: target });
    if (!listRes.ok) {
      errors.push(`resume list step failed: ${JSON.stringify(listRes)}`);
    } else {
      store.updateStep(t.id, step2.stepId, { status: "done" });
    }
  }
  const receiptsBefore = store.listReceipts({ taskId: t.id }).length;
  if (receiptsBefore !== 1) {
    errors.push(`expected 1 folder-creation receipt, found ${receiptsBefore} (no duplicate execution)`);
  }
  store.setTaskStatus(t.id, "completed");

  const finalTask = store.getTask(t.id);
  if (finalTask?.status !== "completed") errors.push("task did not reach 'completed' after resume");

  if (errors.length > 0) fail("B", errors);
  console.log(
    JSON.stringify(
      {
        phase: "B",
        pass: true,
        taskId: t.id,
        restoreSteps: restored?.steps,
        sideEffect: seAfter,
        foldersNamedReports: dirCount,
        receipts: receiptsBefore,
        finalStatus: finalTask.status,
      },
      null,
      2,
    ),
  );
  console.log("RESTART_TEST_PASS");
  process.exit(0);
} else {
  console.error("unknown phase (use A or B)");
  process.exit(2);
}
