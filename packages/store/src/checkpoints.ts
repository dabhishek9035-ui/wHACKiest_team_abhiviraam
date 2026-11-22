// owner: M4 (D Venkata Abhishek, 1TD25CS079)
// purpose: SQLite checkpoint repository — saveCheckpoint/loadCheckpoint.
//          Checkpoints are single-row upserts: a kill mid-write cannot corrupt a
//          checkpoint because SQLite applies the whole row atomically (contract 7.4).
// public interface it must expose: saveCheckpoint / loadCheckpoint over SqlDatabase.
// consumed by: sqlite.ts.
// TODO: none (implemented).

import type { SqlDatabase } from "./sqlitedb.js";
import { StoreError, nowIso, type CheckpointState } from "./types.js";

interface CheckpointRow {
  task_id: string;
  state: string;
  saved_at: string;
}

function validateState(state: CheckpointState): void {
  if (!Array.isArray(state.steps)) {
    throw new StoreError("invalid_input", "saveCheckpoint: state.steps must be an array");
  }
  for (const s of state.steps) {
    if (!s || typeof s.stepId !== "string" || !s.summary) {
      throw new StoreError("invalid_input", "saveCheckpoint: each step needs stepId and summary");
    }
  }
}

export function saveCheckpoint(db: SqlDatabase, taskId: string, state: CheckpointState): CheckpointState {
  const task = db.get(`SELECT id FROM tasks WHERE id = ?`, [taskId]);
  if (!task) throw new StoreError("task_not_found", `task not found: ${taskId}`);
  validateState(state);
  const now = nowIso();
  // Upsert: whole-row atomic replace. WAL + single statement => crash-safe.
  db.run(
    `INSERT INTO checkpoints (task_id, state, saved_at) VALUES (?, ?, ?)
     ON CONFLICT(task_id) DO UPDATE SET state = excluded.state, saved_at = excluded.saved_at`,
    [taskId, JSON.stringify(state), now],
  );
  return state;
}

export function loadCheckpoint(db: SqlDatabase, taskId: string): CheckpointState | null {
  const row = db.get(`SELECT * FROM checkpoints WHERE task_id = ?`, [taskId]) as
    | CheckpointRow
    | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.state) as CheckpointState;
  } catch {
    throw new StoreError("checkpoint_missing", `checkpoint for ${taskId} is corrupt`);
  }
}
