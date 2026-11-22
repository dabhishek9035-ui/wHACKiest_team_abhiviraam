// owner: M4 (D Venkata Abhishek, 1TD25CS079)
// purpose: SQLite task repository — createTask, getTask, listTasks, listPending,
//          setTaskStatus. One row per task; accountContext stored as canonical JSON.
// public interface it must expose: the five task functions over SqlDatabase.
// consumed by: sqlite.ts (composes into SqliteStore).
// TODO: none (implemented).

import type { SqlDatabase } from "./sqlitedb.js";
import {
  PENDING_TASK_STATUSES,
  StoreError,
  newId,
  nowIso,
  type Task,
  type TaskStatus,
} from "./types.js";

interface TaskRow {
  id: string;
  request: string;
  status: string;
  account_context: string | null;
  created_at: string;
  updated_at: string;
}

function rowToTask(row: TaskRow): Task {
  const task: Task = {
    id: row.id,
    request: row.request,
    status: row.status as TaskStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (row.account_context) {
    try {
      task.accountContext = JSON.parse(row.account_context) as Record<string, unknown>;
    } catch {
      // corrupt context is treated as absent; never crash reads
    }
  }
  return task;
}

export function createTask(
  db: SqlDatabase,
  input: { id?: string; request: string; accountContext?: Record<string, unknown>; status?: TaskStatus },
): Task {
  if (!input.request || typeof input.request !== "string") {
    throw new StoreError("invalid_input", "createTask: request must be a non-empty string");
  }
  const now = nowIso();
  const task: Task = {
    id: input.id ?? newId("t"),
    request: input.request,
    status: input.status ?? "received",
    createdAt: now,
    updatedAt: now,
  };
  if (input.accountContext) task.accountContext = input.accountContext;
  db.run(
    `INSERT INTO tasks (id, request, status, account_context, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      task.id,
      task.request,
      task.status,
      task.accountContext ? JSON.stringify(task.accountContext) : null,
      task.createdAt,
      task.updatedAt,
    ],
  );
  return task;
}

export function getTask(db: SqlDatabase, taskId: string): Task | null {
  const row = db.get(`SELECT * FROM tasks WHERE id = ?`, [taskId]) as TaskRow | undefined;
  return row ? rowToTask(row) : null;
}

function requireTask(db: SqlDatabase, taskId: string): TaskRow {
  const row = db.get(`SELECT * FROM tasks WHERE id = ?`, [taskId]) as TaskRow | undefined;
  if (!row) throw new StoreError("task_not_found", `task not found: ${taskId}`);
  return row;
}

export function listTasks(
  db: SqlDatabase,
  filter?: { status?: TaskStatus | TaskStatus[] },
): Task[] {
  let rows: TaskRow[];
  if (filter?.status) {
    const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
    const placeholders = statuses.map(() => "?").join(", ");
    rows = db.all(
      `SELECT * FROM tasks WHERE status IN (${placeholders}) ORDER BY created_at ASC, id ASC`,
      statuses,
    ) as TaskRow[];
  } else {
    rows = db.all(`SELECT * FROM tasks ORDER BY created_at ASC, id ASC`) as TaskRow[];
  }
  return rows.map(rowToTask);
}

/** Non-terminal tasks (restore view / A13): received|planned|running|awaiting_approval|paused. */
export function listPending(db: SqlDatabase): Task[] {
  const placeholders = PENDING_TASK_STATUSES.map(() => "?").join(", ");
  const rows = db.all(
    `SELECT * FROM tasks WHERE status IN (${placeholders}) ORDER BY updated_at ASC, id ASC`,
    [...PENDING_TASK_STATUSES],
  ) as TaskRow[];
  return rows.map(rowToTask);
}

export function setTaskStatus(
  db: SqlDatabase,
  taskId: string,
  status: TaskStatus,
  opts?: { pauseReason?: string },
): Task {
  requireTask(db, taskId);
  const now = nowIso();
  db.run(`UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?`, [status, now, taskId]);
  if (opts?.pauseReason) {
    // Fold the pause reason into the task's checkpoint when one exists (best effort);
    // the authoritative pauseReason also lives on the checkpoint state itself.
    const row = db.get(`SELECT state FROM checkpoints WHERE task_id = ?`, [taskId]) as
      | { state: string }
      | undefined;
    if (row) {
      try {
        const state = JSON.parse(row.state) as Record<string, unknown>;
        state.pauseReason = opts.pauseReason;
        db.run(`UPDATE checkpoints SET state = ?, saved_at = ? WHERE task_id = ?`, [
          JSON.stringify(state),
          now,
          taskId,
        ]);
      } catch {
        // leave checkpoint untouched if it was corrupt
      }
    }
  }
  return getTask(db, taskId) as Task;
}
