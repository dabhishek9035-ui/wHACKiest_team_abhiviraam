// owner: M4 (D Venkata Abhishek, 1TD25CS079)
// purpose: continuity helpers — buildRestoreView (A13: unfinished tasks reappear with
//          correct state) and reconcileSideEffects (A14: resume verifies side effects;
//          undeterminable ones are flagged to ask the user, never blindly retried).
//          Includes the local default verifiers: folder existence is checkable;
//          URL/app launches are not verifiable => unknown.
// public interface it must expose: PENDING_TASK_STATUSES (re-exported from types),
//          buildRestoreView, VerifyVerdict, SideEffectVerifier, defaultVerifiers,
//          verifyWithDefaults, reconcileSideEffects.
// consumed by: M1 runtime resume flow (7.6); M4 scripts/restart-test harness; tests.
// TODO: none (implemented).

import { existsSync, statSync } from "node:fs";
import type { PenguStore } from "./index.js";
import { PENDING_TASK_STATUSES, type SideEffectRecord, type TaskStatus } from "./types.js";

export { PENDING_TASK_STATUSES } from "./types.js";

/**
 * Minimum persisted restore payload per task (contract 7.1 task.list.tasks[]).
 * Excludes secrets and private message content by construction.
 */
export interface RestoreTask {
  taskId: string;
  request: string;
  status: TaskStatus;
  steps: Array<{
    stepId: string;
    summary: string;
    tool?: string;
    server?: string;
    status: string;
  }>;
  pauseReason?: string;
  updatedAt?: string;
  outputRefs?: Record<string, string>;
  accountContext?: Record<string, unknown>;
}

export interface RestoreView {
  tasks: RestoreTask[];
}

/**
 * Builds the restore view for all non-terminal tasks: step summaries and statuses,
 * pause reason, output references and account context (A13).
 */
export function buildRestoreView(store: PenguStore, filter?: { taskId?: string }): RestoreView {
  const pendingTasks = store.listPending();
  const tasks: RestoreTask[] = pendingTasks
    .filter((t) => !filter?.taskId || t.id === filter.taskId)
    .map((t) => {
      const steps = store.listSteps(t.id).map((s) => ({
        stepId: s.id,
        summary: s.summary,
        tool: s.tool,
        server: s.server,
        status: s.status,
      }));
      const cp = store.loadCheckpoint(t.id);
      const item: RestoreTask = {
        taskId: t.id,
        request: t.request,
        status: t.status,
        steps,
        updatedAt: t.updatedAt,
      };
      if (cp?.pauseReason) item.pauseReason = cp.pauseReason;
      if (cp?.outputRefs && Object.keys(cp.outputRefs).length > 0) item.outputRefs = cp.outputRefs;
      if (cp?.accountContext && Object.keys(cp.accountContext).length > 0) {
        item.accountContext = cp.accountContext;
      } else if (t.accountContext && Object.keys(t.accountContext).length > 0) {
        item.accountContext = t.accountContext;
      }
      return item;
    });
  return { tasks };
}

/** Outcome of checking whether an external side effect already took effect. */
export type VerifyVerdict = "verified" | "absent" | "unknown";

/**
 * Verifies one side effect for a given tool.
 * - verified: the operation demonstrably happened (e.g. folder exists)
 * - absent:   demonstrably did NOT complete (safe to re-execute)
 * - unknown:  cannot be determined locally (ask the user; never auto-retry)
 */
export type SideEffectVerifier = (
  tool: string,
  intent: Record<string, unknown>,
) => VerifyVerdict;

/**
 * Default local verifiers (M4 scope):
 * - fs_create_folder: folder exists at the intent path? (read-only check)
 * - browser_open_url / app_launch / anything else: not locally verifiable => unknown.
 */
export const defaultVerifiers: Record<string, SideEffectVerifier> = {
  fs_create_folder: (_tool, intent) => {
    const args = (intent?.args ?? {}) as Record<string, unknown>;
    const path = args.path;
    if (typeof path !== "string" || path.length === 0) return "unknown";
    try {
      return existsSync(path) && statSync(path).isDirectory() ? "verified" : "absent";
    } catch {
      return "unknown";
    }
  },
};

/** Verifier lookup that falls back to "unknown" for tools without a verifier. */
export function verifyWithDefaults(tool: string, intent: Record<string, unknown>): VerifyVerdict {
  const verifier = defaultVerifiers[tool];
  if (!verifier) return "unknown";
  try {
    return verifier(tool, intent);
  } catch {
    return "unknown";
  }
}

export interface ReconcileItem {
  key: string;
  tool: string;
  taskId?: string;
  stateBefore: SideEffectRecord["state"];
  verdict: VerifyVerdict;
  /** trust: keep the receipt; retry: safe to re-execute; ask_user: ask, do not retry. */
  recommendation: "trust" | "retry" | "ask_user";
  action: "completed_as_verified" | "left_open";
}

/**
 * Resume reconciliation (contract 7.6): for every begun-but-not-completed side effect,
 * run the tool's verifier. Verified operations are marked completed (evidence kept).
 * Absent ones stay open for safe retry. Unknown ones stay open and are flagged so M1
 * ASKS the user instead of retrying blindly (A14).
 */
export function reconcileSideEffects(
  store: PenguStore,
  opts?: {
    verifiers?: Record<string, SideEffectVerifier>;
    autoCompleteVerified?: boolean;
    taskId?: string;
  },
): ReconcileItem[] {
  const verifiers = opts?.verifiers ?? defaultVerifiers;
  const autoComplete = opts?.autoCompleteVerified ?? true;
  const begun = store.listSideEffects({ state: "begun", ...(opts?.taskId ? { taskId: opts.taskId } : {}) });
  const items: ReconcileItem[] = [];
  for (const se of begun) {
    const verifier = verifiers[se.tool];
    let verdict: VerifyVerdict = "unknown";
    if (verifier) {
      try {
        verdict = verifier(se.tool, se.intent);
      } catch {
        verdict = "unknown";
      }
    }
    let action: ReconcileItem["action"] = "left_open";
    let recommendation: ReconcileItem["recommendation"];
    if (verdict === "verified") {
      if (autoComplete) {
        store.completeSideEffect(se.key, {
          verified: true,
          outcome: "ok",
          summary: { note: "verified by local verifier during resume" },
        });
        action = "completed_as_verified";
      }
      recommendation = "trust";
    } else if (verdict === "absent") {
      recommendation = "retry"; // demonstrably not done: safe to re-execute once
    } else {
      recommendation = "ask_user"; // undeterminable: ask, never blind-retry
    }
    const item: ReconcileItem = {
      key: se.key,
      tool: se.tool,
      stateBefore: se.state,
      verdict,
      recommendation,
      action,
    };
    if (se.taskId !== undefined) item.taskId = se.taskId;
    items.push(item);
  }
  return items;
}
