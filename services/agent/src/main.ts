/**
 * owner: M1 (Ronit Kapar)
 * purpose: Sidecar bootstrap wiring config, MCP registry, PolicyApprovalGate, Sarvam GLM client, AgentRuntimeLoop, optional M3 VoiceService, and authenticated WS server.
 */

import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import type {
  ApprovalRecord,
  CheckpointState,
  ReceiptRecord,
  SideEffectIntent,
  SideEffectRecord,
  SideEffectResult,
  StepRecord,
  StoreApi,
  TaskRecord,
  TaskState,
  TaskSummaryItem,
  VoiceService,
} from "@pengu/contracts";
import { createGlmClient } from "./llm/glm-client.js";
import { McpToolRegistry } from "./mcp/registry.js";
import { PolicyApprovalGate } from "./policy/approval-gate.js";
import type { ScopeConfig } from "./policy/scope.js";
import { AgentRuntimeLoop } from "./runtime/loop.js";
import { resolveWsAuthToken } from "./server/auth.js";
import { AgentWsServer } from "./server/ws.js";
import { createVoiceService } from "./voice/routes.js";

/**
 * Fallback in-memory StoreApi used only when M4's @pengu/store SQLite adapter
 * is not injected (e.g., standalone M1 startup before G2/G3 merge).
 */
export function createFallbackMemoryStore(): StoreApi {
  const tasks = new Map<string, TaskRecord>();
  const steps = new Map<string, StepRecord>();
  const checkpoints = new Map<string, CheckpointState>();
  const approvals = new Map<string, ApprovalRecord>();
  const receipts: ReceiptRecord[] = [];
  const sideEffects = new Map<string, SideEffectRecord>();

  const toSummary = (task: TaskRecord): TaskSummaryItem => {
    const taskSteps = Array.from(steps.values())
      .filter((s) => s.taskId === task.taskId)
      .map((s) => ({
        stepId: s.stepId,
        summary: s.summary,
        tool: s.tool,
        server: s.server,
        status: s.status,
      }));
    const cp = checkpoints.get(task.taskId);
    return {
      taskId: task.taskId,
      request: task.request,
      status: task.status,
      steps: taskSteps,
      pauseReason: task.pauseReason ?? cp?.pauseReason,
      updatedAt: task.updatedAt,
      outputRefs: cp?.outputRefs,
    };
  };

  return {
    async createTask(input) {
      const now = new Date().toISOString();
      const rec: TaskRecord = {
        taskId: input.taskId,
        request: input.request,
        source: input.source,
        status: "received",
        createdAt: now,
        updatedAt: now,
      };
      tasks.set(input.taskId, rec);
      return rec;
    },
    async getTask(taskId) {
      return tasks.get(taskId) ?? null;
    },
    async listTasks(filter) {
      return Array.from(tasks.values())
        .filter((t) => (!filter?.status ? true : t.status === filter.status))
        .map(toSummary);
    },
    async listPending() {
      const pendingStates = new Set<TaskState>([
        "received",
        "planned",
        "running",
        "awaiting_approval",
        "paused",
      ]);
      return Array.from(tasks.values())
        .filter((t) => pendingStates.has(t.status))
        .map(toSummary);
    },
    async appendStep(step) {
      const now = new Date().toISOString();
      const rec: StepRecord = { ...step, createdAt: now, updatedAt: now };
      steps.set(step.stepId, rec);
      return rec;
    },
    async updateStep(stepId, patch) {
      const rec = steps.get(stepId);
      if (!rec) return null;
      Object.assign(rec, patch, { updatedAt: new Date().toISOString() });
      return rec;
    },
    async saveCheckpoint(taskId, state) {
      checkpoints.set(taskId, state);
    },
    async loadCheckpoint(taskId) {
      return checkpoints.get(taskId) ?? null;
    },
    async recordApproval(record) {
      approvals.set(record.approvalId, record);
    },
    async recordReceipt(record) {
      receipts.push(record);
    },
    async beginSideEffect(key: string, intent: SideEffectIntent) {
      const rec: SideEffectRecord = {
        key,
        intent,
        status: "begun",
        begunAt: new Date().toISOString(),
      };
      sideEffects.set(key, rec);
      return rec;
    },
    async completeSideEffect(key: string, result: SideEffectResult) {
      const rec = sideEffects.get(key);
      if (!rec) return null;
      rec.status = result.status;
      rec.result = result;
      rec.completedAt = result.verifiedAt;
      return rec;
    },
    async getSideEffect(key) {
      return sideEffects.get(key) ?? null;
    },
    async setTaskStatus(taskId, status, options) {
      const rec = tasks.get(taskId);
      if (!rec) return;
      rec.status = status;
      if (options?.pauseReason !== undefined) rec.pauseReason = options.pauseReason;
      if (options?.summary !== undefined) rec.summary = options.summary;
      if (options?.unresolved !== undefined) rec.unresolved = options.unresolved;
      rec.updatedAt = new Date().toISOString();
    },
  };
}

export interface StartAgentOptions {
  store?: StoreApi;
  voice?: VoiceService;
  scopeConfig?: ScopeConfig;
  port?: number;
}

export async function startAgent(options: StartAgentOptions = {}) {
  const sarvamApiKey = process.env.SARVAM_API_KEY ?? "";
  const approvalSecret = process.env.PENGU_APPROVAL_SECRET ?? "";
  const wsAuthToken = resolveWsAuthToken(process.env.PENGU_WS_TOKEN);

  if (!approvalSecret || approvalSecret.length < 16) {
    throw new Error(
      "PENGU_APPROVAL_SECRET must be set (>=16 chars) in environment before starting @pengu/agent."
    );
  }

  const store = options.store ?? createFallbackMemoryStore();
  const registry = new McpToolRegistry();

  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const projectRoot = path.resolve(currentDir, "../../../");
  const gmailAuthEntry = path.join(projectRoot, "mcp", "gmail", "dist", "auth.js");
  let isGmailConnected: () => Promise<boolean> = async () => false;
  if (existsSync(gmailAuthEntry)) {
    try {
      const gmailAuth = await import(pathToFileURL(gmailAuthEntry).href) as {
        isGmailConnected: () => Promise<boolean>;
      };
      isGmailConnected = gmailAuth.isGmailConnected;
    } catch (err) {
      console.warn(
        "[pengu-agent] Gmail credential status is unavailable:",
        err instanceof Error ? err.message : String(err)
      );
    }
  }
  // The config lives under src/mcp in development; tsc does not copy JSON files
  // into dist, so compiled startup needs the source-tree fallback.
  const configCandidates = [
    path.join(currentDir, "mcp", "servers.config.json"),
    path.resolve(currentDir, "..", "src", "mcp", "servers.config.json"),
  ];
  const serversConfigPath =
    configCandidates.find((candidate) => existsSync(candidate)) ??
    path.join(currentDir, "mcp", "servers.config.json");
  try {
    await registry.loadFromConfigFile(serversConfigPath);
  } catch (err) {
    console.warn(
      "[pengu-agent] Could not load MCP servers from servers.config.json (expected until M3/M4 servers are built):",
      err instanceof Error ? err.message : String(err)
    );
  }

  const scopeConfig: ScopeConfig = options.scopeConfig ?? {
    grantedScopes: [
      "gmail:read",
      "gmail:compose",
      "gmail:send",
      "fs:approved_roots",
      "browser:http_https",
      "app:allowlist",
      "shell:allowlist",
    ],
    approvedRoots: (process.env.PENGU_APPROVED_ROOTS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    allowlistedApps: ["notepad", "calc", "chrome", "code"],
    allowlistedShellCommands: [
      "sys_info",
      "disk_usage",
      "list_processes_summary",
      "git_status",
    ],
  };

  let wsServer: AgentWsServer;
  let gmailAuthProcess: ChildProcess | null = null;

  const gate = new PolicyApprovalGate({
    approvalSecret,
    scopeConfig,
    store,
    invokePreview: async (_server, previewTool, args) => {
      const res = await registry.invokeTool(previewTool, args);
      if (!res.ok || !res.data || typeof res.data !== "object") {
        throw new Error(res.error?.message ?? "Preview tool returned no data.");
      }
      return res.data as Record<string, unknown>;
    },
    onInvalidated: (approvalId, reason) => {
      wsServer?.broadcast({
        type: "approval.invalidated",
        approvalId,
        reason,
      });
    },
  });

  const glm = createGlmClient({ apiKey: sarvamApiKey });
  const runtime = new AgentRuntimeLoop({
    glm,
    registry,
    gate,
    store,
    emit: (event) => wsServer?.broadcast(event),
  });

  wsServer = new AgentWsServer({
    host: "127.0.0.1",
    port: options.port ?? Number(process.env.PENGU_WS_PORT ?? 7777),
    authToken: wsAuthToken,
    runtime,
    store,
    voice: options.voice ?? createVoiceService(),
    isGmailConnected,
    startGmailAuth: () => {
      if (gmailAuthProcess && gmailAuthProcess.exitCode === null) return false;
      const authEntry = path.join(projectRoot, "mcp", "gmail", "dist", "auth-cli.js");
      if (!existsSync(authEntry)) return false;
      const child = spawn(process.execPath, [authEntry], {
        cwd: projectRoot,
        env: { ...process.env },
        stdio: ["ignore", "ignore", "pipe"],
        windowsHide: true,
      });
      let authError = "";
      child.stderr?.on("data", (chunk) => {
        authError = `${authError}${String(chunk)}`.slice(-4000);
      });
      gmailAuthProcess = child;
      child.once("error", () => {
        if (gmailAuthProcess === child) gmailAuthProcess = null;
        wsServer?.broadcast({
          type: "gmail.auth.status",
          status: "failed",
          message: "Could not start Google sign-in. Check the agent setup and try again.",
        });
      });
      child.once("close", async (code) => {
        if (gmailAuthProcess === child) gmailAuthProcess = null;
        const connected = code === 0 && await isGmailConnected();
        wsServer?.broadcast({
          type: "gmail.auth.status",
          status: connected ? "connected" : "failed",
          message: connected
            ? "Gmail is connected."
            : authError.includes("access_denied")
              ? "Google denied sign-in. If this OAuth app is in Testing, add this Google account under Google Cloud Console → Google Auth Platform → Audience → Test users. A Workspace administrator can also block access."
              : "Google sign-in did not complete. Select Connect Gmail to try again.",
        });
      });
      return true;
    },
  });

  const bound = await wsServer.start();
  console.log(
    `[pengu-agent] Listening on ws://${bound.host}:${bound.port} (auth token active, never logged)`
  );

  const shutdown = async () => {
    if (gmailAuthProcess && !gmailAuthProcess.killed) {
      gmailAuthProcess.kill();
      gmailAuthProcess = null;
    }
    await wsServer.stop();
    await registry.closeAll();
  };

  process.once("SIGINT", () => void shutdown().finally(() => process.exit(0)));
  process.once("SIGTERM", () => void shutdown().finally(() => process.exit(0)));

  return { wsServer, runtime, registry, gate, store, shutdown };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
) {
  void startAgent().catch((err) => {
    console.error("[pengu-agent] Fatal startup error:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
