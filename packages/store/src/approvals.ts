// owner: M4 (D Venkata Abhishek, 1TD25CS079)
// purpose: SQLite approvals repository — recordApproval (upsert by approvalId),
//          getApproval, listApprovals. Records the exact-action approvals issued by
//          M1's policy gate; approvals are never silently carried across a restart.
// public interface it must expose: recordApproval / getApproval / listApprovals.
// consumed by: sqlite.ts.
// TODO: none (implemented).

import type { SqlDatabase } from "./sqlitedb.js";
import { newId, type ApprovalDecision, type ApprovalRecord } from "./types.js";

interface ApprovalRow {
  id: string;
  task_id: string | null;
  tool: string;
  args_hash: string;
  preview: string | null;
  decision: string | null;
  issued_at: string;
  expires_at: string;
  decided_at: string | null;
}

function rowToApproval(row: ApprovalRow): ApprovalRecord {
  const rec: ApprovalRecord = {
    approvalId: row.id,
    tool: row.tool,
    argsHash: row.args_hash,
    issuedAt: row.issued_at,
    expiresAt: row.expires_at,
  };
  if (row.task_id !== null) rec.taskId = row.task_id;
  if (row.preview) {
    try {
      rec.preview = JSON.parse(row.preview) as Record<string, unknown>;
    } catch {
      // preview is advisory; ignore corrupt JSON on read
    }
  }
  if (row.decision !== null) rec.decision = row.decision as ApprovalDecision;
  if (row.decided_at !== null) rec.decidedAt = row.decided_at;
  return rec;
}

/**
 * Insert-or-update by approvalId. Call once when the approval is created
 * (no decision yet) and again when the user decides or it is invalidated/expired.
 */
export function recordApproval(db: SqlDatabase, input: ApprovalRecord): ApprovalRecord {
  if (!input.approvalId || !input.tool || !input.argsHash) {
    throw new Error("recordApproval: approvalId, tool and argsHash are required");
  }
  const decidedAt = input.decidedAt ?? (input.decision ? new Date().toISOString() : undefined);
  db.run(
    `INSERT INTO approvals (id, task_id, tool, args_hash, preview, decision, issued_at, expires_at, decided_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       task_id = COALESCE(excluded.task_id, approvals.task_id),
       tool = excluded.tool,
       args_hash = excluded.args_hash,
       preview = COALESCE(excluded.preview, approvals.preview),
       decision = excluded.decision,
       expires_at = excluded.expires_at,
       decided_at = COALESCE(excluded.decided_at, approvals.decided_at)`,
    [
      input.approvalId,
      input.taskId ?? null,
      input.tool,
      input.argsHash,
      input.preview ? JSON.stringify(input.preview) : null,
      input.decision ?? null,
      input.issuedAt,
      input.expiresAt,
      decidedAt ?? null,
    ],
  );
  const row = db.get(`SELECT * FROM approvals WHERE id = ?`, [input.approvalId]) as ApprovalRow;
  return rowToApproval(row);
}

export function getApproval(db: SqlDatabase, approvalId: string): ApprovalRecord | null {
  const row = db.get(`SELECT * FROM approvals WHERE id = ?`, [approvalId]) as ApprovalRow | undefined;
  return row ? rowToApproval(row) : null;
}

export function listApprovals(
  db: SqlDatabase,
  filter?: { taskId?: string; tool?: string },
): ApprovalRecord[] {
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
    `SELECT * FROM approvals ${where} ORDER BY issued_at ASC, id ASC`,
    params,
  ) as ApprovalRow[];
  return rows.map(rowToApproval);
}

/** Convenience: generate an approval id when the caller does not have one yet. */
export function newApprovalId(): string {
  return newId("a");
}
