// owner: M4 (D Venkata Abhishek, 1TD25CS079)
// purpose: SQLite side-effect repository — beginSideEffect/completeSideEffect/
//          getSideEffect/listSideEffects. Duplicate-safe external actions (rule 5):
//          persist intent BEFORE executing, persist result AFTER; on resume a record
//          that is begun-but-not-completed must be verified or asked about, never
//          blindly retried.
// public interface it must expose: the four side-effect functions over SqlDatabase.
// consumed by: sqlite.ts; restore.ts (reconciliation).
// TODO: none (implemented).

import type { SqlDatabase } from "./sqlitedb.js";
import {
  StoreError,
  nowIso,
  type SideEffectRecord,
  type SideEffectResult,
  type SideEffectState,
} from "./types.js";

interface SideEffectRow {
  key: string;
  task_id: string | null;
  tool: string;
  intent: string;
  result: string | null;
  state: string;
  created_at: string;
  updated_at: string;
}

function rowToRecord(row: SideEffectRow): SideEffectRecord {
  const rec: SideEffectRecord = {
    key: row.key,
    tool: row.tool,
    state: row.state as SideEffectState,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    intent: {},
  };
  if (row.task_id !== null) rec.taskId = row.task_id;
  try {
    rec.intent = JSON.parse(row.intent) as Record<string, unknown>;
  } catch {
    // keep empty intent on corrupt JSON; reads must not crash
  }
  if (row.result) {
    try {
      rec.result = JSON.parse(row.result) as Record<string, unknown>;
    } catch {
      // result stays undefined on corrupt JSON
    }
  }
  return rec;
}

/**
 * Persist intent BEFORE executing the external action. Idempotent: if the key
 * already exists, the existing record is returned unchanged (never overwrite intent).
 */
export function beginSideEffect(
  db: SqlDatabase,
  key: string,
  intent: { taskId?: string; tool: string; args?: Record<string, unknown> },
): SideEffectRecord {
  if (!key || !intent.tool) {
    throw new StoreError("invalid_input", "beginSideEffect: key and tool are required");
  }
  const existing = db.get(`SELECT * FROM side_effects WHERE key = ?`, [key]) as
    | SideEffectRow
    | undefined;
  if (existing) return rowToRecord(existing);

  const now = nowIso();
  const intentJson = JSON.stringify({ args: intent.args ?? {} });
  db.run(
    `INSERT INTO side_effects (key, task_id, tool, intent, result, state, created_at, updated_at)
     VALUES (?, ?, ?, ?, NULL, 'begun', ?, ?)`,
    [key, intent.taskId ?? null, intent.tool, intentJson, now, now],
  );
  const row = db.get(`SELECT * FROM side_effects WHERE key = ?`, [key]) as SideEffectRow;
  return rowToRecord(row);
}

/**
 * Persist the result AFTER the action executed. Requires a begun record (intent
 * persisted first). Idempotent on completed records: re-completing returns the
 * existing record unchanged. Failing overwrites state with the failure result.
 */
export function completeSideEffect(
  db: SqlDatabase,
  key: string,
  result: SideEffectResult,
): SideEffectRecord {
  const existing = db.get(`SELECT * FROM side_effects WHERE key = ?`, [key]) as
    | SideEffectRow
    | undefined;
  if (!existing) {
    throw new StoreError(
      "side_effect_missing",
      `completeSideEffect: no intent record for key ${key} (begin must run before execute)`,
    );
  }
  const current = rowToRecord(existing);
  if (current.state === "completed") return current; // already done — nothing to change

  const outcome: "ok" | "failed" = result.outcome === "failed" || result.ok === false ? "failed" : "ok";
  const state: SideEffectState = outcome === "failed" ? "failed" : "completed";
  const now = nowIso();
  const resultJson = JSON.stringify({
    ok: result.ok ?? outcome === "ok",
    verified: result.verified,
    outcome,
    summary: result.summary ?? {},
  });
  db.run(`UPDATE side_effects SET result = ?, state = ?, updated_at = ? WHERE key = ?`, [
    resultJson,
    state,
    now,
    key,
  ]);
  const row = db.get(`SELECT * FROM side_effects WHERE key = ?`, [key]) as SideEffectRow;
  return rowToRecord(row);
}

export function getSideEffect(db: SqlDatabase, key: string): SideEffectRecord | null {
  const row = db.get(`SELECT * FROM side_effects WHERE key = ?`, [key]) as SideEffectRow | undefined;
  return row ? rowToRecord(row) : null;
}

export function listSideEffects(
  db: SqlDatabase,
  filter?: { state?: SideEffectState; taskId?: string },
): SideEffectRecord[] {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filter?.state) {
    clauses.push("state = ?");
    params.push(filter.state);
  }
  if (filter?.taskId) {
    clauses.push("task_id = ?");
    params.push(filter.taskId);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = db.all(
    `SELECT * FROM side_effects ${where} ORDER BY created_at ASC, key ASC`,
    params,
  ) as SideEffectRow[];
  return rows.map(rowToRecord);
}
