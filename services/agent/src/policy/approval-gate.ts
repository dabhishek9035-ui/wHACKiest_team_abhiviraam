/**
 * owner: M1 (Ronit Kapar)
 * purpose: Central policy & approval gate enforcing hard-deny, risk classification, scope, exact preview, HMAC token minting, expiry, and invalidation.
 */

import { randomUUID } from "node:crypto";
import type {
  ApprovalDecision,
  ApprovalPreview,
  SignedApprovalToken,
  StoreApi,
  ToolManifestEntry,
} from "@pengu/contracts";
import { classifyToolCall } from "./classify.js";
import { evaluateHardDeny } from "./hard-deny.js";
import { checkScope, type ScopeConfig } from "./scope.js";
import {
  computeArgsHash,
  computeDraftContentHash,
  signApprovalToken,
} from "./token.js";

export type PreviewInvoker = (
  server: string,
  previewTool: string,
  args: Record<string, unknown>
) => Promise<Record<string, unknown>>;

export interface GateEvaluateInput {
  taskId: string;
  stepId: string;
  server: string;
  tool: string;
  args: Record<string, unknown>;
  manifestEntry?: ToolManifestEntry;
  origin?: "trusted_user" | "untrusted_content";
}

export type GateDecision =
  | { outcome: "allow"; riskClass: "READ" | "ROUTINE"; reason: string }
  | { outcome: "deny"; code: string; reason: string; approvable: false }
  | {
      outcome: "require_approval";
      approvalId: string;
      preview: ApprovalPreview;
      reason: string;
      expiresAt: string;
      argsHash: string;
    };

export interface PendingApprovalState {
  approvalId: string;
  taskId: string;
  stepId: string;
  server: string;
  tool: string;
  previewTool: string;
  originalArgs: Record<string, unknown>;
  resolvedArgs: Record<string, unknown>;
  argsHash: string;
  preview: ApprovalPreview;
  reason: string;
  expiresAt: string;
  createdAt: string;
  status: "pending" | "approved" | "denied" | "expired" | "invalidated";
}

export interface ApprovalResolutionResult {
  approved: boolean;
  invalidated?: boolean;
  reason: string;
  token?: SignedApprovalToken;
  pending?: PendingApprovalState;
}

export interface PolicyApprovalGateOptions {
  approvalSecret: string;
  scopeConfig: ScopeConfig;
  invokePreview: PreviewInvoker;
  store?: StoreApi;
  approvalTtlSeconds?: number;
  now?: () => number;
  onInvalidated?: (approvalId: string, reason: string) => void;
}

export class PolicyApprovalGate {
  private readonly approvalSecret: string;
  private readonly scopeConfig: ScopeConfig;
  private readonly invokePreview: PreviewInvoker;
  private readonly store?: StoreApi;
  private readonly approvalTtlMs: number;
  private readonly now: () => number;
  private readonly onInvalidated?: (approvalId: string, reason: string) => void;

  /** In-memory only: approvals are NEVER persisted as reusable tokens across restarts. */
  private readonly pending = new Map<string, PendingApprovalState>();

  constructor(options: PolicyApprovalGateOptions) {
    this.approvalSecret = options.approvalSecret;
    this.scopeConfig = options.scopeConfig;
    this.invokePreview = options.invokePreview;
    this.store = options.store;
    this.approvalTtlMs = (options.approvalTtlSeconds ?? 180) * 1000;
    this.now = options.now ?? (() => Date.now());
    this.onInvalidated = options.onInvalidated;
  }

  async evaluate(input: GateEvaluateInput): Promise<GateDecision> {
    // 1. Hard-deny checks (never approvable).
    const hardDeny = evaluateHardDeny({
      tool: input.tool,
      args: input.args,
      allowlistedShellCommands: this.scopeConfig.allowlistedShellCommands,
      origin: input.origin ?? "trusted_user",
    });
    if (hardDeny.denied) {
      return {
        outcome: "deny",
        code: hardDeny.code ?? "HARD_DENIED",
        reason: hardDeny.reason ?? "Action hard-denied by policy.",
        approvable: false,
      };
    }

    // 2. Manifest-based risk classification (fail closed on missing/unknown).
    const classification = classifyToolCall(input.manifestEntry);
    if (!classification.allowed || !input.manifestEntry) {
      return {
        outcome: "deny",
        code: "MANIFEST_DENIED",
        reason: classification.reason,
        approvable: false,
      };
    }

    // 3. Granted-scope verification (fail closed).
    const scopeCheck = checkScope(
      input.manifestEntry,
      input.args,
      this.scopeConfig
    );
    if (!scopeCheck.inScope) {
      return {
        outcome: "deny",
        code: "SCOPE_DENIED",
        reason: scopeCheck.reason,
        approvable: false,
      };
    }

    // 4. READ and ROUTINE actions inside granted scope proceed without per-task approval.
    if (!classification.requiresApproval) {
      return {
        outcome: "allow",
        riskClass: classification.riskClass as "READ" | "ROUTINE",
        reason: classification.reason,
      };
    }

    // 5. CONSEQUENTIAL actions: call previewTool to build exact preview + resolvedArgs.
    const previewTool = input.manifestEntry.previewTool!;
    const built = await this.buildExactPreviewAndResolvedArgs(
      input.server,
      input.tool,
      previewTool,
      input.args
    );
    if (!built.ok) {
      return {
        outcome: "deny",
        code: "PREVIEW_BUILD_FAILED",
        reason: built.reason,
        approvable: false,
      };
    }

    const nowMs = this.now();
    const approvalId = `apr_${randomUUID()}`;
    const createdAt = new Date(nowMs).toISOString();
    const expiresAt = new Date(nowMs + this.approvalTtlMs).toISOString();
    const argsHash = computeArgsHash(built.resolvedArgs);

    const state: PendingApprovalState = {
      approvalId,
      taskId: input.taskId,
      stepId: input.stepId,
      server: input.server,
      tool: input.tool,
      previewTool,
      originalArgs: { ...input.args },
      resolvedArgs: built.resolvedArgs,
      argsHash,
      preview: built.preview,
      reason: classification.reason,
      expiresAt,
      createdAt,
      status: "pending",
    };

    this.pending.set(approvalId, state);

    if (this.store) {
      await this.store.recordApproval({
        approvalId,
        taskId: input.taskId,
        stepId: input.stepId,
        tool: input.tool,
        argsHash,
        preview: built.preview,
        reason: classification.reason,
        expiresAt,
        createdAt,
      });
    }

    return {
      outcome: "require_approval",
      approvalId,
      preview: built.preview,
      reason: classification.reason,
      expiresAt,
      argsHash,
    };
  }

  getPending(approvalId: string): PendingApprovalState | undefined {
    return this.pending.get(approvalId);
  }

  async invalidateApproval(approvalId: string, reason: string): Promise<void> {
    const state = this.pending.get(approvalId);
    if (!state || state.status !== "pending") return;
    state.status = "invalidated";
    if (this.store) {
      await this.store.recordApproval({
        approvalId: state.approvalId,
        taskId: state.taskId,
        stepId: state.stepId,
        tool: state.tool,
        argsHash: state.argsHash,
        preview: state.preview,
        decision: "invalidated",
        reason,
        expiresAt: state.expiresAt,
        createdAt: state.createdAt,
        decidedAt: new Date(this.now()).toISOString(),
      });
    }
    this.onInvalidated?.(approvalId, reason);
  }

  /**
   * Resolves a user's approve/deny decision.
   * On "approve": verifies expiry, re-runs previewTool to detect any post-preview
   * mutation (e.g. edited Gmail draft), and mints an HMAC-SHA256 token bound to
   * {approvalId, tool, argsHash, expiresAt}.
   */
  async resolveDecision(
    approvalId: string,
    decision: ApprovalDecision
  ): Promise<ApprovalResolutionResult> {
    const state = this.pending.get(approvalId);
    if (!state) {
      return {
        approved: false,
        reason: `Approval '${approvalId}' does not exist or was cleared on restart (fresh approval required).`,
      };
    }

    if (state.status !== "pending") {
      return {
        approved: false,
        invalidated: state.status === "invalidated" || state.status === "expired",
        reason: `Approval '${approvalId}' is no longer pending (status: ${state.status}).`,
        pending: state,
      };
    }

    const nowMs = this.now();
    if (nowMs >= Date.parse(state.expiresAt)) {
      state.status = "expired";
      const reason = `Approval '${approvalId}' expired at ${state.expiresAt}.`;
      if (this.store) {
        await this.store.recordApproval({
          approvalId: state.approvalId,
          taskId: state.taskId,
          stepId: state.stepId,
          tool: state.tool,
          argsHash: state.argsHash,
          preview: state.preview,
          decision: "expired",
          reason,
          expiresAt: state.expiresAt,
          createdAt: state.createdAt,
          decidedAt: new Date(nowMs).toISOString(),
        });
      }
      this.onInvalidated?.(approvalId, reason);
      return { approved: false, invalidated: true, reason, pending: state };
    }

    if (decision === "deny") {
      state.status = "denied";
      if (this.store) {
        await this.store.recordApproval({
          approvalId: state.approvalId,
          taskId: state.taskId,
          stepId: state.stepId,
          tool: state.tool,
          argsHash: state.argsHash,
          preview: state.preview,
          decision: "deny",
          reason: "Denied by user.",
          expiresAt: state.expiresAt,
          createdAt: state.createdAt,
          decidedAt: new Date(nowMs).toISOString(),
        });
      }
      return { approved: false, reason: "User denied the consequential action.", pending: state };
    }

    // Re-resolve live state before minting token to catch post-preview edits (T-04).
    const fresh = await this.buildExactPreviewAndResolvedArgs(
      state.server,
      state.tool,
      state.previewTool,
      state.originalArgs
    );
    if (!fresh.ok) {
      const reason = `Approval invalidated: unable to re-verify live target (${fresh.reason}).`;
      await this.invalidateApproval(approvalId, reason);
      return { approved: false, invalidated: true, reason, pending: state };
    }

    const liveArgsHash = computeArgsHash(fresh.resolvedArgs);
    if (liveArgsHash !== state.argsHash) {
      const reason =
        "Approval invalidated: target content or parameters changed after the approval preview was shown.";
      await this.invalidateApproval(approvalId, reason);
      return { approved: false, invalidated: true, reason, pending: state };
    }

    state.status = "approved";
    const token = signApprovalToken(
      {
        approvalId: state.approvalId,
        tool: state.tool,
        argsHash: state.argsHash,
        expiresAt: state.expiresAt,
      },
      this.approvalSecret
    );

    if (this.store) {
      await this.store.recordApproval({
        approvalId: state.approvalId,
        taskId: state.taskId,
        stepId: state.stepId,
        tool: state.tool,
        argsHash: state.argsHash,
        preview: state.preview,
        decision: "approve",
        reason: "Approved by user.",
        expiresAt: state.expiresAt,
        createdAt: state.createdAt,
        decidedAt: new Date(nowMs).toISOString(),
      });
    }

    return {
      approved: true,
      reason: "Approved and signed for exact resolved action.",
      token,
      pending: state,
    };
  }

  private async buildExactPreviewAndResolvedArgs(
    server: string,
    tool: string,
    previewTool: string,
    args: Record<string, unknown>
  ): Promise<
    | { ok: true; preview: ApprovalPreview; resolvedArgs: Record<string, unknown> }
    | { ok: false; reason: string }
  > {
    let raw: Record<string, unknown>;
    try {
      raw = await this.invokePreview(server, previewTool, args);
    } catch (err) {
      return {
        ok: false,
        reason: `Preview tool '${previewTool}' failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    if (tool === "gmail_send_draft") {
      const draftId = String(raw.draftId ?? args.draftId ?? "");
      const to = String(raw.to ?? raw.recipient ?? "");
      const subject = String(raw.subject ?? "");
      const body = String(raw.body ?? "");
      const account = raw.account ? String(raw.account) : "authorized-gmail";

      if (!draftId || !to || !subject) {
        return {
          ok: false,
          reason:
            "Incomplete email preview: draftId, recipient (to), and subject are required before requesting approval.",
        };
      }

      const contentHash =
        typeof raw.contentHash === "string" && raw.contentHash.length === 64
          ? raw.contentHash
          : computeDraftContentHash(to, subject, body);

      const preview: ApprovalPreview = {
        title: `Send Gmail draft to ${to}`,
        account,
        recipient: to,
        subject,
        body,
        impact: `Sends an external email to ${to} immediately.`,
        reversible: false,
      };

      return {
        ok: true,
        preview,
        resolvedArgs: { draftId, contentHash },
      };
    }

    if (tool === "shell_run_restricted") {
      const commandId = String(raw.commandId ?? args.commandId ?? "");
      const resolvedArgsVal =
        (raw.args as Record<string, unknown> | string[] | undefined) ??
        (args.args as Record<string, unknown> | string[] | undefined) ??
        [];
      const cwd = String(raw.cwd ?? "");
      const purpose = String(raw.purpose ?? "");
      const impact = String(raw.impact ?? "Runs an allowlisted PowerShell command.");
      const reversible = Boolean(raw.reversible ?? true);
      const command = raw.command ? String(raw.command) : commandId;

      if (!commandId || !cwd || !purpose) {
        return {
          ok: false,
          reason:
            "Incomplete shell preview: commandId, cwd, and purpose are required before requesting approval.",
        };
      }

      const preview: ApprovalPreview = {
        title: `Run allowlisted command '${commandId}'`,
        command,
        commandId,
        args: resolvedArgsVal,
        cwd,
        purpose,
        impact,
        reversible,
      };

      return {
        ok: true,
        preview,
        resolvedArgs: { commandId, args: resolvedArgsVal, cwd },
      };
    }

    // Generic consequential tool fallback
    const title = String(raw.title ?? `Execute ${tool}`);
    const impact = String(raw.impact ?? "Performs a consequential action.");
    const reversible = Boolean(raw.reversible ?? false);
    return {
      ok: true,
      preview: { title, impact, reversible },
      resolvedArgs: { ...args },
    };
  }
}
