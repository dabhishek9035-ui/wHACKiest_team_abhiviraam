-- Pengu store schema (owner: M4 / D Venkata Abhishek)
-- Tables: tasks, steps, checkpoints, approvals, receipts, side_effects.
-- All timestamps are ISO-8601 UTC strings. JSON columns hold canonical JSON text.
-- PRAGMAs (WAL, foreign_keys, busy_timeout) are applied by the driver at open time.

CREATE TABLE IF NOT EXISTS tasks (
  id              TEXT PRIMARY KEY,
  request         TEXT NOT NULL,             -- trusted user request text (never secrets)
  status          TEXT NOT NULL,             -- received|planned|running|awaiting_approval|paused|completed|partial|failed|cancelled
  account_context TEXT,                      -- JSON: non-secret account/integration context
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);

CREATE TABLE IF NOT EXISTS steps (
  id         TEXT PRIMARY KEY,
  task_id    TEXT NOT NULL REFERENCES tasks(id),
  idx        INTEGER NOT NULL,               -- ordering within the task
  tool       TEXT,
  server     TEXT,
  kind       TEXT,                           -- read|routine|consequential
  status     TEXT NOT NULL,                  -- planned|running|awaiting_approval|done|failed|skipped
  summary    TEXT NOT NULL,                  -- visible step summary (no private model output)
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (task_id, idx)
);
CREATE INDEX IF NOT EXISTS idx_steps_task ON steps(task_id, idx);

CREATE TABLE IF NOT EXISTS checkpoints (
  task_id  TEXT PRIMARY KEY REFERENCES tasks(id),
  state    TEXT NOT NULL,                    -- JSON per contract 7.4: request, plan, steps, outputRefs, lastVerifiedState, pauseReason, accountContext
  saved_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS approvals (
  id         TEXT PRIMARY KEY,               -- approvalId
  task_id    TEXT,
  tool       TEXT NOT NULL,
  args_hash  TEXT NOT NULL,                  -- sha256(canonicalJSON(resolvedArgs))
  preview    TEXT,                           -- JSON of the exact-action preview shown to the user (no secrets)
  decision   TEXT,                           -- approved|denied|expired|invalidated|NULL while pending
  issued_at  TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  decided_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_approvals_task ON approvals(task_id);

CREATE TABLE IF NOT EXISTS receipts (
  id         TEXT PRIMARY KEY,
  task_id    TEXT,
  tool       TEXT NOT NULL,
  args_hash  TEXT NOT NULL,
  outcome    TEXT NOT NULL,                  -- ok|failed|unknown
  detail     TEXT,                           -- JSON capped summary (never full file/command contents)
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_receipts_task ON receipts(task_id);

CREATE TABLE IF NOT EXISTS side_effects (
  key        TEXT PRIMARY KEY,               -- idempotency key, e.g. "fs_create_folder:<abs path>"
  task_id    TEXT,
  tool       TEXT NOT NULL,
  intent     TEXT NOT NULL,                  -- JSON: resolved args at intent time (persisted BEFORE execution)
  result     TEXT,                           -- JSON: result summary persisted AFTER execution
  state      TEXT NOT NULL,                  -- begun|completed|failed
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sideeffects_state ON side_effects(state);
