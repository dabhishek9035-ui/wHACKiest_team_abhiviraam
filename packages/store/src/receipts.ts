// owner: M4 (D Venkata Abhishek, 1TD25CS079)
// purpose: SQLite receipts repository — recordReceipt, listReceipts. A receipt is the
//          persisted proof that a tool result was verified (used by resume to trust a
//          completed operation instead of repeating it; A14).
// public interface it must expose: recordReceipt / listReceipts over SqlDatabase.
// consumed by: sqlite.ts.
// TODO: none (implemented).

import type { SqlDatabase } from "./sqlitedb.js";
import { newId, nowIso, type ReceiptOutcome, type ReceiptRecord } from "./types.js";

interface ReceiptRow {
  id: string;
  task_id: string | null;
  tool: string;
  args_hash: string;
  outcome: string;
  detail: string | null;
  created_at: string;
}

function rowToReceipt(row: ReceiptRow): ReceiptRecord {
  const rec: ReceiptRecord = {
    id: row.id,
    tool: row.tool,
    argsHash: row.args_hash,
    outcome: row.outcome as ReceiptOutcome,
    createdAt: row.created_at,
  };
  if (row.task_id !== null) rec.taskId = row.task_id;
  if (row.detail) {
    try {
      rec.detail = JSON.parse(row.detail) as Record<string, unknown>;
    } catch {
      // detail is advisory; ignore corrupt JSON on read
    }
  }
  return rec;
}

export function recordReceipt(
  db: SqlDatabase,
  input: {
    id?: string;
    taskId?: string;
    tool: string;
    argsHash: string;
    outcome: ReceiptOutcome;
    detail?: Record<string, unknown>;
  },
): ReceiptRecord {
  if (!input.tool || !input.argsHash || !input.outcome) {
    throw new Error("recordReceipt: tool, argsHash and outcome are required");
  }
  const rec: ReceiptRecord = {
    id: input.id ?? newId("r"),
    tool: input.tool,
    argsHash: input.argsHash,
    outcome: input.outcome,
    createdAt: nowIso(),
  };
  if (input.taskId !== undefined) rec.taskId = input.taskId;
  if (input.detail !== undefined) rec.detail = input.detail;
  db.run(
    `INSERT INTO receipts (id, task_id, tool, args_hash, outcome, detail, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      rec.id,
      rec.taskId ?? null,
      rec.tool,
      rec.argsHash,
      rec.outcome,
      rec.detail ? JSON.stringify(rec.detail) : null,
      rec.createdAt,
    ],
  );
  return rec;
}

export function listReceipts(
  db: SqlDatabase,
  filter?: { taskId?: string; tool?: string },
): ReceiptRecord[] {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filter?.taskId) {
    clauses.push("task_id = ?");
    params.push(filter.taskId);
  }
  if (filter?.tool) {
    clauses.push("tool = ?");
    params.push(filter.tool);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = db.all(
    `SELECT * FROM receipts ${where} ORDER BY created_at ASC, id ASC`,
    params,
  ) as ReceiptRow[];
  return rows.map(rowToReceipt);
}
