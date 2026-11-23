/**
 * owner: M1 (Ronit Kapar)
 * purpose: Restart-safe resume orchestrator implementing Section 7.6 (server/token checks, receipt trust, side-effect verification, fresh approval for consequential steps).
 */

import type {
  CheckpointStepSnapshot,
  ServerEvent,
  SideEffectRecord,
  StoreApi,
} from "@pengu/contracts";
import type { McpToolRegistry } from "../mcp/registry.js";

export type VerificationOutcome =
  | { state: "verified_completed"; summary: string; outputRefs?: Record<string, string> }
  | { state: "verified_not_executed"; summary: string }
  | { state: "unknown"; reason: string };

export type SideEffectVerifier = (
  record: SideEffectRecord
) => Promise<VerificationOutcome>;

export interface ResumeDependencies {
  store: StoreApi;
  registry: McpToolRegistry;
  verifiers: Record<string, SideEffectVerifier>;
  checkAuthHealth?: () => Promise<{ ok: boolean; reason?: string }>;
  emit: (event: ServerEvent) => void;
}

export interface ResumePlanResult {
  ok: boolean;
  pausedForUserClarification?: boolean;
  pauseReason?: string;
  skippedStepIds: string[];
  stepsToExecute: CheckpointStepSnapshot[];
  requiresFreshApprovalStepIds: string[];
}

export class TaskResumer {
  private readonly deps: ResumeDependencies;

  constructor(deps: ResumeDependencies) {
    this.deps = deps;
  }

  /**
   * Executes Section 7.6 pre-resume verification:
   * 1) Verify required MCP servers are connected and Gmail/account token is valid.
   * 2) For each step:
   *    - Completed receipt/side-effect => trust receipt & skip (never repeat).
   *    - Begun-but-not-completed side-effect => run verifier; if unknown, pause & ask user.
   *    - Pending CONSEQUENTIAL step => mark for fresh approval (never reuse pre-restart approval).
   */
  async prepareResume(taskId: string): Promise<ResumePlanResult> {
    const checkpoint = await this.deps.store.loadCheckpoint(taskId);
    if (!checkpoint) {
      return {
        ok: false,
        pauseReason: `No saved checkpoint found for task '${taskId}'.`,
        skippedStepIds: [],
        stepsToExecute: [],
        requiresFreshApprovalStepIds: [],
      };
    }

    // 1. Check required MCP servers are up
    const requiredServers = new Set(
      checkpoint.steps
        .filter((s) => s.status !== "done" && s.status !== "skipped")
        .map((s) => s.server)
        .filter((srv) => srv && srv !== "unknown")
    );
    for (const serverId of requiredServers) {
      if (!this.deps.registry.isServerConnected(serverId)) {
        const reason = `Cannot resume: MCP server '${serverId}' is not connected.`;
        await this.deps.store.setTaskStatus(taskId, "paused", { pauseReason: reason });
        return {
          ok: false,
          pauseReason: reason,
          skippedStepIds: [],
          stepsToExecute: [],
          requiresFreshApprovalStepIds: [],
        };
      }
    }

    // Check Gmail/account OAuth health if provided
    if (this.deps.checkAuthHealth) {
      const auth = await this.deps.checkAuthHealth();
      if (!auth.ok) {
        const reason = `Cannot resume: account authorization check failed (${auth.reason ?? "invalid token"}).`;
        await this.deps.store.setTaskStatus(taskId, "paused", { pauseReason: reason });
        return {
          ok: false,
          pauseReason: reason,
          skippedStepIds: [],
          stepsToExecute: [],
          requiresFreshApprovalStepIds: [],
        };
      }
    }

    const skippedStepIds: string[] = [];
    const stepsToExecute: CheckpointStepSnapshot[] = [];
    const requiresFreshApprovalStepIds: string[] = [];

    // 2. Inspect each step's receipt / side-effect record
    for (const step of checkpoint.steps) {
      if (step.status === "done" || step.status === "skipped") {
        skippedStepIds.push(step.stepId);
        continue;
      }

      if (step.sideEffectKey) {
        const record = await this.deps.store.getSideEffect(step.sideEffectKey);
        if (record?.status === "completed") {
          // Trust completed receipt — never repeat!
          await this.deps.store.updateStep(step.stepId, {
            status: "done",
            summary: `${step.summary} (verified already completed via receipt)`,
          });
          skippedStepIds.push(step.stepId);
          continue;
        }

        if (record?.status === "begun") {
          const verifier = this.deps.verifiers[step.tool];
          if (!verifier) {
            const pauseReason = `Step '${step.summary}' started before restart and its outcome cannot be verified automatically. Please confirm whether it already completed before continuing.`;
            await this.deps.store.setTaskStatus(taskId, "paused", { pauseReason });
            this.deps.emit({
              type: "task.finished",
              taskId,
              status: "paused",
              summary: pauseReason,
              unresolved: [step.summary],
            });
            return {
              ok: false,
              pausedForUserClarification: true,
              pauseReason,
              skippedStepIds,
              stepsToExecute,
              requiresFreshApprovalStepIds,
            };
          }

          const verified = await verifier(record);
          if (verified.state === "verified_completed") {
            const nowIso = new Date().toISOString();
            await this.deps.store.completeSideEffect(step.sideEffectKey, {
              status: "completed",
              summary: verified.summary,
              outputRefs: verified.outputRefs,
              verifiedAt: nowIso,
            });
            await this.deps.store.recordReceipt({
              receiptId: `rcpt_${step.stepId}`,
              taskId,
              stepId: step.stepId,
              tool: step.tool,
              server: step.server,
              sideEffectKey: step.sideEffectKey,
              ok: true,
              summary: verified.summary,
              outputRefs: verified.outputRefs,
              verifiedAt: nowIso,
            });
            await this.deps.store.updateStep(step.stepId, {
              status: "done",
              summary: verified.summary,
            });
            skippedStepIds.push(step.stepId);
            continue;
          }

          if (verified.state === "unknown") {
            const pauseReason = `Indeterminate side effect for '${step.summary}': ${verified.reason}. Pengu will not retry blindly — please confirm before continuing.`;
            await this.deps.store.setTaskStatus(taskId, "paused", { pauseReason });
            this.deps.emit({
              type: "task.finished",
              taskId,
              status: "paused",
              summary: pauseReason,
              unresolved: [step.summary],
            });
            return {
              ok: false,
              pausedForUserClarification: true,
              pauseReason,
              skippedStepIds,
              stepsToExecute,
              requiresFreshApprovalStepIds,
            };
          }
          // verified_not_executed falls through to stepsToExecute below
        }
      }

      // 3. Any not-yet-executed CONSEQUENTIAL step MUST obtain a fresh approval after restart
      if (step.kind === "consequential") {
        requiresFreshApprovalStepIds.push(step.stepId);
      }
      stepsToExecute.push(step);
    }

    return {
      ok: true,
      skippedStepIds,
      stepsToExecute,
      requiresFreshApprovalStepIds,
    };
  }
}
