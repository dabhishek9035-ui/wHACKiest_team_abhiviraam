/**
 * owner: M1 (Ronit Kapar)
 * purpose: Core agent execution loop: plan -> policy gate -> approval pause/resume -> MCP invoke -> verify -> receipt -> checkpoint -> honest terminal state.
 */

import { randomUUID } from "node:crypto";
import {
  isUntrustedResult,
  type ApprovalDecision,
  type CheckpointStepSnapshot,
  type MessageSource,
  type ServerEvent,
  type SignedApprovalToken,
  type StoreApi,
} from "@pengu/contracts";
import type { GlmClient } from "../llm/glm-client.js";
import {
  buildSystemPrompt,
  buildUserTurnMessage,
  formatToolOutputForLlm,
  type ChatMessage,
} from "../llm/prompts.js";
import type { McpToolRegistry } from "../mcp/registry.js";
import type { PolicyApprovalGate } from "../policy/approval-gate.js";
import { computeArgsHash } from "../policy/token.js";
import { mapTaskToPetState, resolveTerminalStatus } from "./lifecycle.js";
import { buildPlannedStep } from "./planner.js";
import { TaskResumer, type SideEffectVerifier } from "./resume.js";

export interface ActiveTaskContext {
  taskId: string;
  request: string;
  messages: ChatMessage[];
  steps: CheckpointStepSnapshot[];
  outputRefs: Record<string, string>;
  unresolved: string[];
  cancelled: boolean;
  /** Tracks whether untrusted external data has entered the conversation. */
  sawUntrustedData: boolean;
  pendingApproval?: {
    approvalId: string;
    step: CheckpointStepSnapshot;
    toolCallId: string;
  };
}

export interface AgentRuntimeOptions {
  glm: GlmClient;
  registry: McpToolRegistry;
  gate: PolicyApprovalGate;
  store: StoreApi;
  verifiers?: Record<string, SideEffectVerifier>;
  checkAuthHealth?: () => Promise<{ ok: boolean; reason?: string }>;
  emit: (event: ServerEvent) => void;
  maxTurns?: number;
}

export class AgentRuntimeLoop {
  private readonly glm: GlmClient;
  private readonly registry: McpToolRegistry;
  private readonly gate: PolicyApprovalGate;
  private readonly store: StoreApi;
  private readonly emit: (event: ServerEvent) => void;
  private readonly resumer: TaskResumer;
  private readonly maxTurns: number;

  private readonly activeTasks = new Map<string, ActiveTaskContext>();
  private readonly approvalToTask = new Map<string, string>();

  constructor(options: AgentRuntimeOptions) {
    this.glm = options.glm;
    this.registry = options.registry;
    this.gate = options.gate;
    this.store = options.store;
    this.emit = options.emit;
    this.maxTurns = options.maxTurns ?? 12;
    this.resumer = new TaskResumer({
      store: options.store,
      registry: options.registry,
      verifiers: options.verifiers ?? {},
      checkAuthHealth: options.checkAuthHealth,
      emit: options.emit,
    });
  }

  async handleUserMessage(input: {
    taskId?: string;
    text: string;
    source: MessageSource;
  }): Promise<string> {
    const taskId = input.taskId ?? `task_${randomUUID()}`;
    await this.store.createTask({
      taskId,
      request: input.text,
      source: input.source,
    });

    this.emit({ type: "task.created", taskId, request: input.text });
    this.emit({ type: "pet.state", state: mapTaskToPetState("received") });

    const ctx: ActiveTaskContext = {
      taskId,
      request: input.text,
      messages: [
        { role: "system", content: buildSystemPrompt() },
        buildUserTurnMessage(input.text, input.source),
      ],
      steps: [],
      outputRefs: {},
      unresolved: [],
      cancelled: false,
      sawUntrustedData: false,
    };
    this.activeTasks.set(taskId, ctx);

    await this.runLoop(ctx);
    return taskId;
  }

  async handleApprovalDecision(
    approvalId: string,
    decision: ApprovalDecision
  ): Promise<void> {
    const taskId = this.approvalToTask.get(approvalId);
    const ctx = taskId ? this.activeTasks.get(taskId) : undefined;
    const resolution = await this.gate.resolveDecision(approvalId, decision);

    if (!ctx || !ctx.pendingApproval || ctx.pendingApproval.approvalId !== approvalId) {
      if (!resolution.approved) {
        this.emit({
          type: "error",
          code: "APPROVAL_NOT_ACTIVE",
          message: resolution.reason,
        });
      }
      return;
    }

    const { step, toolCallId } = ctx.pendingApproval;
    ctx.pendingApproval = undefined;
    this.approvalToTask.delete(approvalId);

    if (!resolution.approved || !resolution.token) {
      step.status = decision === "deny" ? "skipped" : "failed";
      ctx.unresolved.push(`${step.summary}: ${resolution.reason}`);
      await this.store.updateStep(step.stepId, {
        status: step.status,
        summary: `${step.summary} (${resolution.reason})`,
      });
      this.emit({
        type: "task.step",
        taskId: ctx.taskId,
        stepId: step.stepId,
        tool: step.tool,
        server: step.server,
        kind: step.kind,
        status: step.status,
        summary: `${step.summary} — ${resolution.reason}`,
      });

      ctx.messages.push({
        role: "tool",
        tool_call_id: toolCallId,
        content: formatToolOutputForLlm(
          step.tool,
          { ok: false, denied: true, reason: resolution.reason },
          false
        ),
      });

      await this.persistCheckpoint(ctx, `Approval not granted: ${resolution.reason}`);
      await this.finishTask(ctx, resolution.reason);
      return;
    }

    // Execute approved consequential tool with server-side HMAC token injection.
    await this.executeToolStep(ctx, step, toolCallId, resolution.token);

    if (!ctx.cancelled) {
      await this.runLoop(ctx);
    }
  }

  async handleTaskResume(taskId: string): Promise<void> {
    const plan = await this.resumer.prepareResume(taskId);
    if (!plan.ok) {
      if (!plan.pausedForUserClarification) {
        this.emit({
          type: "error",
          code: "RESUME_BLOCKED",
          message: plan.pauseReason ?? "Task cannot be resumed right now.",
        });
      }
      return;
    }

    const checkpoint = await this.store.loadCheckpoint(taskId);
    if (!checkpoint) return;

    const ctx: ActiveTaskContext = {
      taskId,
      request: checkpoint.request,
      messages: [
        { role: "system", content: buildSystemPrompt() },
        buildUserTurnMessage(checkpoint.request, "text"),
      ],
      steps: checkpoint.steps,
      outputRefs: { ...checkpoint.outputRefs },
      unresolved: [],
      cancelled: false,
      sawUntrustedData: false,
    };
    this.activeTasks.set(taskId, ctx);
    await this.store.setTaskStatus(taskId, "running");
    this.emit({ type: "pet.state", state: "executing" });

    // Execute any remaining planned steps from checkpoint in order
    for (const step of plan.stepsToExecute) {
      if (ctx.cancelled) break;
      const pausedForApproval = await this.evaluateAndRunStep(
        ctx,
        step,
        `resume_${step.stepId}`
      );
      if (pausedForApproval) {
        return; // Paused waiting for fresh approval
      }
    }

    if (!ctx.cancelled) {
      await this.finishTask(
        ctx,
        `Resumed task completed (${plan.skippedStepIds.length} verified step(s) skipped without duplication).`
      );
    }
  }

  async handleTaskCancel(taskId: string): Promise<void> {
    const ctx = this.activeTasks.get(taskId);
    if (ctx) {
      ctx.cancelled = true;
      if (ctx.pendingApproval) {
        await this.gate.invalidateApproval(
          ctx.pendingApproval.approvalId,
          "Task was cancelled by user."
        );
        this.approvalToTask.delete(ctx.pendingApproval.approvalId);
        ctx.pendingApproval = undefined;
      }
      await this.finishTask(ctx, "Task cancelled by user.", { cancelled: true });
      return;
    }

    await this.store.setTaskStatus(taskId, "cancelled", {
      summary: "Task cancelled by user.",
    });
    this.emit({
      type: "task.finished",
      taskId,
      status: "cancelled",
      summary: "Task cancelled by user.",
      unresolved: [],
    });
    this.emit({ type: "pet.state", state: "idle" });
  }

  private async runLoop(ctx: ActiveTaskContext): Promise<void> {
    await this.store.setTaskStatus(ctx.taskId, "running");
    this.emit({ type: "pet.state", state: "thinking" });

    for (let turn = 0; turn < this.maxTurns; turn++) {
      if (ctx.cancelled) return;

      const completion = await this.glm.complete(
        ctx.messages,
        this.registry.getModelVisibleTools()
      );

      // No tool calls => final assistant summary
      if (completion.toolCalls.length === 0) {
        const finalSummary = completion.content.trim() || "Task finished.";
        await this.finishTask(ctx, finalSummary);
        return;
      }

      // Record assistant tool-call turn (strictly without reasoning_content)
      ctx.messages.push({
        role: "assistant",
        content: completion.content || "",
        tool_calls: completion.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: { name: tc.name, arguments: JSON.stringify(tc.args) },
        })),
      });

      for (const proposal of completion.toolCalls) {
        if (ctx.cancelled) return;
        const planned = buildPlannedStep(proposal, this.registry);
        const stepId = `step_${randomUUID()}`;
        const step: CheckpointStepSnapshot = {
          stepId,
          tool: planned.tool,
          server: planned.server,
          kind: planned.kind,
          status: "planned",
          summary: planned.summary,
          args: planned.args,
        };
        ctx.steps.push(step);

        await this.store.appendStep({
          stepId,
          taskId: ctx.taskId,
          tool: step.tool,
          server: step.server,
          kind: step.kind,
          status: "planned",
          summary: step.summary,
          args: step.args,
        });

        this.emit({
          type: "task.step",
          taskId: ctx.taskId,
          stepId,
          tool: step.tool,
          server: step.server,
          kind: step.kind,
          status: "planned",
          summary: step.summary,
        });

        await this.persistCheckpoint(ctx);

        const pausedForApproval = await this.evaluateAndRunStep(
          ctx,
          step,
          proposal.id
        );
        if (pausedForApproval) {
          return; // Wait for user approval.decision
        }
      }
    }

    ctx.unresolved.push("Reached maximum orchestration turns.");
    await this.finishTask(ctx, "Stopped after reaching maximum orchestration turns.");
  }

  private async evaluateAndRunStep(
    ctx: ActiveTaskContext,
    step: CheckpointStepSnapshot,
    toolCallId: string
  ): Promise<boolean> {
    const reg = this.registry.getTool(step.tool);
    const gateDecision = await this.gate.evaluate({
      taskId: ctx.taskId,
      stepId: step.stepId,
      server: step.server,
      tool: step.tool,
      args: step.args ?? {},
      manifestEntry: reg?.manifest,
      origin: "trusted_user",
    });

    if (gateDecision.outcome === "deny") {
      step.status = "failed";
      ctx.unresolved.push(`${step.summary}: ${gateDecision.reason}`);
      await this.store.updateStep(step.stepId, {
        status: "failed",
        summary: `${step.summary} (denied: ${gateDecision.reason})`,
      });
      this.emit({
        type: "task.step",
        taskId: ctx.taskId,
        stepId: step.stepId,
        tool: step.tool,
        server: step.server,
        kind: step.kind,
        status: "failed",
        summary: `Denied: ${gateDecision.reason}`,
      });
      ctx.messages.push({
        role: "tool",
        tool_call_id: toolCallId,
        content: formatToolOutputForLlm(
          step.tool,
          { ok: false, denied: true, code: gateDecision.code, reason: gateDecision.reason },
          false
        ),
      });
      await this.persistCheckpoint(ctx);
      return false;
    }

    if (gateDecision.outcome === "require_approval") {
      step.status = "awaiting_approval";
      await this.store.updateStep(step.stepId, { status: "awaiting_approval" });
      await this.store.setTaskStatus(ctx.taskId, "awaiting_approval", {
        pauseReason: gateDecision.reason,
      });

      ctx.pendingApproval = {
        approvalId: gateDecision.approvalId,
        step,
        toolCallId,
      };
      this.approvalToTask.set(gateDecision.approvalId, ctx.taskId);

      await this.persistCheckpoint(ctx, gateDecision.reason);

      this.emit({
        type: "task.step",
        taskId: ctx.taskId,
        stepId: step.stepId,
        tool: step.tool,
        server: step.server,
        kind: step.kind,
        status: "awaiting_approval",
        summary: step.summary,
      });
      this.emit({ type: "pet.state", state: "awaiting_approval" });
      this.emit({
        type: "approval.requested",
        approvalId: gateDecision.approvalId,
        taskId: ctx.taskId,
        preview: gateDecision.preview,
        reason: gateDecision.reason,
        expiresAt: gateDecision.expiresAt,
      });
      return true;
    }

    await this.executeToolStep(ctx, step, toolCallId);
    return false;
  }

  private async executeToolStep(
    ctx: ActiveTaskContext,
    step: CheckpointStepSnapshot,
    toolCallId: string,
    approvalToken?: SignedApprovalToken
  ): Promise<void> {
    const reg = this.registry.getTool(step.tool);
    step.status = "running";
    await this.store.updateStep(step.stepId, { status: "running" });
    this.emit({ type: "pet.state", state: "executing" });
    this.emit({
      type: "task.step",
      taskId: ctx.taskId,
      stepId: step.stepId,
      tool: step.tool,
      server: step.server,
      kind: step.kind,
      status: "running",
      summary: step.summary,
    });

    // Duplicate-safe side-effect intent persistence before execution
    let sideEffectKey: string | undefined;
    if (reg?.manifest.sideEffect) {
      const argsHash = computeArgsHash(step.args ?? {});
      sideEffectKey = `${ctx.taskId}:${step.stepId}:${step.tool}:${argsHash}`;
      step.sideEffectKey = sideEffectKey;
      await this.store.updateStep(step.stepId, { sideEffectKey });
      await this.store.beginSideEffect(sideEffectKey, {
        taskId: ctx.taskId,
        stepId: step.stepId,
        tool: step.tool,
        server: step.server,
        argsHash,
        summary: step.summary,
      });
      await this.persistCheckpoint(ctx);
    }

    const result = await this.registry.invokeTool(
      step.tool,
      step.args ?? {},
      approvalToken
    );

    const nowIso = new Date().toISOString();
    const untrusted = Boolean(result.untrusted || isUntrustedResult(result.data));
    if (untrusted) {
      ctx.sawUntrustedData = true;
    }

    if (result.ok) {
      step.status = "done";
      const refs = this.extractOutputRefs(result.data);
      Object.assign(ctx.outputRefs, refs);

      if (sideEffectKey) {
        await this.store.completeSideEffect(sideEffectKey, {
          status: "completed",
          summary: step.summary,
          outputRefs: refs,
          verifiedAt: nowIso,
        });
      }
      await this.store.recordReceipt({
        receiptId: `rcpt_${randomUUID()}`,
        taskId: ctx.taskId,
        stepId: step.stepId,
        tool: step.tool,
        server: step.server,
        sideEffectKey,
        ok: true,
        summary: step.summary,
        outputRefs: refs,
        verifiedAt: nowIso,
      });
      await this.store.updateStep(step.stepId, { status: "done" });
      this.emit({
        type: "task.step",
        taskId: ctx.taskId,
        stepId: step.stepId,
        tool: step.tool,
        server: step.server,
        kind: step.kind,
        status: "done",
        summary: step.summary,
      });
      ctx.messages.push({
        role: "tool",
        tool_call_id: toolCallId,
        content: formatToolOutputForLlm(step.tool, result.data, untrusted),
      });
    } else {
      const errMsg = result.error?.message ?? "Tool invocation failed.";
      step.status = "failed";
      ctx.unresolved.push(`${step.summary}: ${errMsg}`);
      if (sideEffectKey) {
        await this.store.completeSideEffect(sideEffectKey, {
          status: "failed",
          summary: errMsg,
          verifiedAt: nowIso,
        });
      }
      await this.store.updateStep(step.stepId, {
        status: "failed",
        summary: `${step.summary} (failed: ${errMsg})`,
      });
      this.emit({
        type: "task.step",
        taskId: ctx.taskId,
        stepId: step.stepId,
        tool: step.tool,
        server: step.server,
        kind: step.kind,
        status: "failed",
        summary: `Failed: ${errMsg}`,
      });
      ctx.messages.push({
        role: "tool",
        tool_call_id: toolCallId,
        content: formatToolOutputForLlm(
          step.tool,
          { ok: false, error: errMsg },
          false
        ),
      });
    }

    await this.persistCheckpoint(ctx);
  }

  private async finishTask(
    ctx: ActiveTaskContext,
    summary: string,
    opts: { cancelled?: boolean; paused?: boolean } = {}
  ): Promise<void> {
    const status = resolveTerminalStatus(ctx.steps, {
      cancelled: opts.cancelled,
      paused: opts.paused,
      unresolved: ctx.unresolved,
    });

    await this.store.setTaskStatus(ctx.taskId, status, {
      summary,
      unresolved: ctx.unresolved,
    });
    await this.persistCheckpoint(ctx);

    this.emit({
      type: "task.finished",
      taskId: ctx.taskId,
      status,
      summary,
      unresolved: ctx.unresolved,
    });
    this.emit({ type: "pet.state", state: mapTaskToPetState(status) });
    this.activeTasks.delete(ctx.taskId);
  }

  private async persistCheckpoint(
    ctx: ActiveTaskContext,
    pauseReason?: string
  ): Promise<void> {
    await this.store.saveCheckpoint(ctx.taskId, {
      request: ctx.request,
      plan: ctx.steps.map((s) => s.summary),
      steps: ctx.steps.map((s) => ({ ...s })),
      outputRefs: { ...ctx.outputRefs },
      lastVerifiedState:
        ctx.steps.filter((s) => s.status === "done").at(-1)?.summary ?? "initialized",
      pauseReason,
      updatedAt: new Date().toISOString(),
    });
  }

  private extractOutputRefs(data: unknown): Record<string, string> {
    const refs: Record<string, string> = {};
    if (!data || typeof data !== "object") return refs;
    const obj = data as Record<string, unknown>;
    if (typeof obj.draftId === "string") refs.draftId = obj.draftId;
    if (typeof obj.messageId === "string") refs.messageId = obj.messageId;
    if (typeof obj.folderPath === "string") refs.folderPath = obj.folderPath;
    if (typeof obj.path === "string") refs.path = obj.path;
    return refs;
  }
}
