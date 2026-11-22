// owner: M4 (D Venkata Abhishek, 1TD25CS079)
// purpose: SQLite step repository — appendStep, updateStep, listSteps.
//          Steps are the visible per-task operations (contract 7.1 task.step events).
// public interface it must expose: appendStep / updateStep / listSteps over SqlDatabase.
// consumed by: sqlite.ts.
// TODO: none (implemented).

import type { SqlDatabase } from "./sqlitedb.js";
import { StoreError, newId, nowIso, type Step, type StepKind, type StepStatus } from "./types.js";

interface StepRow {
  id: string;
  task_id: string;
  idx: number;
  tool: string | null;
  server: string | null;
  kind: string | null;
  status: string;
  summary: string;
  created_at: string;
  updated_at: string;
}

function rowToStep(row: StepRow): Step {
  const step: Step = {
    id: row.id,
    taskId: row.task_id,
    idx: row.idx,
    status: row.status as StepStatus,
    summary: row.summary,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (row.tool !== null) step.tool = row.tool;
  if (row.server !== null) step.server = row.server;
  if (row.kind !== null) step.kind = row.kind as StepKind;
  return step;
}

export function appendStep(
  db: SqlDatabase,
  taskId: string,
  input: { id?: string; tool?: string; server?: string; kind?: StepKind; status?: StepStatus; summary: string },
): Step {
  const task = db.get(`SELECT id FROM tasks WHERE id = ?`, [taskId]);
  if (!task) throw new StoreError("task_not_found", `task not found: ${taskId}`);
  if (!input.summary || typeof input.summary !== "string") {
    throw new StoreError("invalid_input", "appendStep: summary must be a non-empty string");
  }
  const now = nowIso();
  const maxRow = db.get(`SELECT COALESCE(MAX(idx), -1) AS maxIdx FROM steps WHERE task_id = ?`, [
    taskId,
  ]) as { maxIdx: number } | undefined;
  const idx = (maxRow?.maxIdx ?? -1) + 1;
  const step: Step = {
    id: input.id ?? newId("s"),
    taskId,
    idx,
    status: input.status ?? "planned",
    summary: input.summary,
    createdAt: now,
    updatedAt: now,
  };
  if (input.tool !== undefined) step.tool = input.tool;
  if (input.server !== undefined) step.server = input.server;
  if (input.kind !== undefined) step.kind = input.kind;
  db.run(
    `INSERT INTO steps (id, task_id, idx, tool, server, kind, status, summary, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      step.id,
      step.taskId,
      step.idx,
      step.tool ?? null,
      step.server ?? null,
      step.kind ?? null,
      step.status,
      step.summary,
      step.createdAt,
      step.updatedAt,
    ],
  );
  // Touch the parent task so updated_at reflects activity.
  db.run(`UPDATE tasks SET updated_at = ? WHERE id = ?`, [now, taskId]);
  return step;
}

export function updateStep(
  db: SqlDatabase,
  taskId: string,
  stepId: string,
  patch: { status?: StepStatus; summary?: string },
): Step {
  const existing = db.get(`SELECT * FROM steps WHERE id = ? AND task_id = ?`, [stepId, taskId]) as
    | StepRow
    | undefined;
  if (!existing) {
    throw new StoreError("step_not_found", `step not found: ${stepId} (task ${taskId})`);
  }
  const now = nowIso();
  db.run(`UPDATE steps SET status = ?, summary = ?, updated_at = ? WHERE id = ?`, [
    patch.status ?? existing.status,
    patch.summary ?? existing.summary,
    now,
    stepId,
  ]);
  db.run(`UPDATE tasks SET updated_at = ? WHERE id = ?`, [now, taskId]);
  const row = db.get(`SELECT * FROM steps WHERE id = ?`, [stepId]) as StepRow;
  return rowToStep(row);
}

export function listSteps(db: SqlDatabase, taskId: string): Step[] {
  const rows = db.all(`SELECT * FROM steps WHERE task_id = ? ORDER BY idx ASC`, [taskId]) as StepRow[];
  return rows.map(rowToStep);
}
