// owner: M4 (D Venkata Abhishek, 1TD25CS079)
// purpose: minimal synchronous SQLite driver interface with two adapters:
//          better-sqlite3 (canonical, contract 7.4) and node:sqlite (fallback so the
//          store still works where better-sqlite3 native prebuilds are unavailable).
// public interface it must expose: SqlDatabase { exec, run, get, all, transaction,
//          close, driverName } and openSqliteDatabase(dbPath).
// consumed by: tasks.ts/steps.ts/checkpoints.ts/approvals.ts/receipts.ts/sideeffects.ts/sqlite.ts.
// TODO: none (implemented).

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface SqlDatabase {
  readonly driverName: "better-sqlite3" | "node:sqlite";
  exec(sql: string): void;
  run(sql: string, params?: unknown[]): { changes: number | bigint };
  get(sql: string, params?: unknown[]): unknown;
  all(sql: string, params?: unknown[]): unknown[];
  /** Runs fn atomically: either every write inside applies, or none do. */
  transaction<T>(fn: () => T): T;
  close(): void;
}

/** Loads schema.sql from next to the compiled module (dist/ or src/). */
export function loadSchemaSql(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    process.env.PENGU_STORE_SCHEMA,
    join(here, "schema.sql"),
    join(here, "..", "src", "schema.sql"),
  ].filter((c): c is string => Boolean(c));
  for (const c of candidates) {
    try {
      return readFileSync(c, "utf8");
    } catch {
      // try next candidate
    }
  }
  throw new Error(
    "pengu store: schema.sql not found (set PENGU_STORE_SCHEMA or run the build so dist/schema.sql exists)",
  );
}

type BetterDatabase = {
  pragma(source: string): unknown;
  prepare(sql: string): {
    run(...params: unknown[]): { changes: number | bigint };
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
  };
  transaction<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R;
  close(): void;
  exec(sql: string): void;
};

async function openBetterSqlite3(dbPath: string): Promise<SqlDatabase> {
  const mod = await import("better-sqlite3");
  const Database = mod.default as unknown as new (path: string, options?: object) => BetterDatabase;
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  return {
    driverName: "better-sqlite3",
    exec: (sql) => db.exec(sql),
    run: (sql, params = []) => db.prepare(sql).run(...params),
    get: (sql, params = []) => db.prepare(sql).get(...params),
    all: (sql, params = []) => db.prepare(sql).all(...params),
    transaction: <T>(fn: () => T): T => db.transaction(fn)(),
    close: () => db.close(),
  };
}

type NodeSqliteDatabase = {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...params: unknown[]): { changes: number | bigint };
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
  };
  close(): void;
};

async function openNodeSqlite(dbPath: string): Promise<SqlDatabase> {
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(dbPath) as NodeSqliteDatabase;
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA busy_timeout = 5000;");
  return {
    driverName: "node:sqlite",
    exec: (sql) => db.exec(sql),
    run: (sql, params = []) => db.prepare(sql).run(...params),
    get: (sql, params = []) => db.prepare(sql).get(...params),
    all: (sql, params = []) => db.prepare(sql).all(...params),
    transaction: <T>(fn: () => T): T => {
      db.exec("BEGIN IMMEDIATE");
      try {
        const result = fn();
        db.exec("COMMIT");
        return result;
      } catch (err) {
        try {
          db.exec("ROLLBACK");
        } catch {
          // rollback of a failed transaction is best-effort
        }
        throw err;
      }
    },
    close: () => db.close(),
  };
}

/**
 * Opens (creating if needed) the SQLite database file.
 * Prefers better-sqlite3; falls back to the built-in node:sqlite module when the
 * native module cannot be loaded (still SQLite, no native build needed).
 */
export async function openSqliteDatabase(dbPath: string): Promise<SqlDatabase> {
  let lastError: unknown;
  try {
    return await openBetterSqlite3(dbPath);
  } catch (err) {
    lastError = err;
  }
  try {
    const db = await openNodeSqlite(dbPath);
    console.error(
      `pengu store: better-sqlite3 unavailable (${String(lastError)}), using node:sqlite fallback`,
    );
    return db;
  } catch (err) {
    throw new Error(
      `pengu store: could not open SQLite database (${dbPath}); better-sqlite3 and node:sqlite both failed: ${String(err)}`,
    );
  }
}
