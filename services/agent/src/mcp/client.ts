/**
 * owner: M1 (Ronit Kapar)
 * purpose: MCP stdio JSON-RPC 2.0 client spawning Gmail and Local MCP servers, listing tools, and injecting reserved server-side approval tokens.
 */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import readline from "node:readline";
import {
  RESERVED_APPROVAL_TOKEN_FIELD,
  type SignedApprovalToken,
  type ToolCallResult,
} from "@pengu/contracts";

export interface McpToolDescriptor {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface McpServerConnection {
  readonly serverId: string;
  connect(): Promise<void>;
  isConnected(): boolean;
  listTools(): Promise<McpToolDescriptor[]>;
  callTool(
    toolName: string,
    args: Record<string, unknown>,
    approvalToken?: SignedApprovalToken
  ): Promise<ToolCallResult>;
  close(): Promise<void>;
}

export interface StdioServerLaunchSpec {
  serverId: string;
  command: string;
  args: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  requestTimeoutMs?: number;
}

interface PendingRpc {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

/**
 * Lightweight MCP stdio client speaking newline-delimited JSON-RPC 2.0
 * compatible with @modelcontextprotocol/sdk stdio servers.
 */
export class McpStdioClient implements McpServerConnection {
  readonly serverId: string;
  private readonly spec: StdioServerLaunchSpec;
  private proc: ChildProcessWithoutNullStreams | null = null;
  private rl: readline.Interface | null = null;
  private nextId = 1;
  private connected = false;
  private readonly pending = new Map<number, PendingRpc>();

  constructor(spec: StdioServerLaunchSpec) {
    this.serverId = spec.serverId;
    this.spec = spec;
  }

  isConnected(): boolean {
    return this.connected && this.proc !== null && !this.proc.killed;
  }

  async connect(): Promise<void> {
    if (this.isConnected()) return;

    this.proc = spawn(this.spec.command, this.spec.args, {
      cwd: this.spec.cwd,
      env: { ...process.env, ...this.spec.env },
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.rl = readline.createInterface({ input: this.proc.stdout });
    this.rl.on("line", (line) => this.handleLine(line));

    this.proc.on("exit", (code) => {
      this.connected = false;
      for (const [, req] of this.pending) {
        clearTimeout(req.timer);
        req.reject(
          new Error(`MCP server '${this.serverId}' exited with code ${code ?? -1}.`)
        );
      }
      this.pending.clear();
    });

    await this.sendRequest("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "pengu-agent", version: "0.1.0" },
    });

    this.sendNotification("notifications/initialized", {});
    this.connected = true;
  }

  async listTools(): Promise<McpToolDescriptor[]> {
    const res = (await this.sendRequest("tools/list", {})) as {
      tools?: McpToolDescriptor[];
    };
    return Array.isArray(res?.tools) ? res.tools : [];
  }

  async callTool(
    toolName: string,
    args: Record<string, unknown>,
    approvalToken?: SignedApprovalToken
  ): Promise<ToolCallResult> {
    // Strip any accidental reserved field from caller args, then inject verified token server-side only.
    const sanitizedArgs: Record<string, unknown> = { ...args };
    delete sanitizedArgs[RESERVED_APPROVAL_TOKEN_FIELD];

    const wireArgs: Record<string, unknown> = approvalToken
      ? { ...sanitizedArgs, [RESERVED_APPROVAL_TOKEN_FIELD]: approvalToken }
      : sanitizedArgs;

    try {
      const res = (await this.sendRequest("tools/call", {
        name: toolName,
        arguments: wireArgs,
      })) as {
        isError?: boolean;
        content?: Array<{ type: string; text?: string }>;
        structuredContent?: unknown;
      };

      const data = this.extractToolPayload(res);
      if (res?.isError) {
        return {
          ok: false,
          error: {
            code: "MCP_TOOL_ERROR",
            message: typeof data === "string" ? data : JSON.stringify(data),
          },
        };
      }

      const isUntrusted =
        typeof data === "object" &&
        data !== null &&
        (data as Record<string, unknown>).untrusted === true;

      return { ok: true, data, untrusted: isUntrusted };
    } catch (err) {
      return {
        ok: false,
        error: {
          code: "MCP_CALL_FAILED",
          message: err instanceof Error ? err.message : String(err),
        },
      };
    }
  }

  async close(): Promise<void> {
    this.connected = false;
    this.rl?.close();
    this.rl = null;
    if (this.proc && !this.proc.killed) {
      this.proc.kill();
    }
    this.proc = null;
  }

  private extractToolPayload(res: {
    content?: Array<{ type: string; text?: string }>;
    structuredContent?: unknown;
  }): unknown {
    if (res?.structuredContent !== undefined) return res.structuredContent;
    const textItem = res?.content?.find((c) => c.type === "text" && typeof c.text === "string");
    if (!textItem?.text) return res;
    try {
      return JSON.parse(textItem.text);
    } catch {
      return textItem.text;
    }
  }

  private sendNotification(method: string, params: Record<string, unknown>): void {
    if (!this.proc?.stdin.writable) return;
    const payload = JSON.stringify({ jsonrpc: "2.0", method, params });
    this.proc.stdin.write(payload + "\n");
  }

  private sendRequest(
    method: string,
    params: Record<string, unknown>
  ): Promise<unknown> {
    if (!this.proc?.stdin.writable) {
      return Promise.reject(
        new Error(`MCP server '${this.serverId}' stdin is not writable.`)
      );
    }
    const id = this.nextId++;
    const timeoutMs = this.spec.requestTimeoutMs ?? 30_000;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new Error(
            `MCP request '${method}' to server '${this.serverId}' timed out after ${timeoutMs}ms.`
          )
        );
      }, timeoutMs);

      this.pending.set(id, { resolve, reject, timer });
      const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params });
      this.proc!.stdin.write(payload + "\n");
    });
  }

  private handleLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      return;
    }
    const id = typeof msg.id === "number" ? msg.id : undefined;
    if (id === undefined) return;
    const req = this.pending.get(id);
    if (!req) return;
    this.pending.delete(id);
    clearTimeout(req.timer);

    if (msg.error) {
      const errObj = msg.error as { message?: string; code?: number };
      req.reject(
        new Error(errObj.message ?? `MCP JSON-RPC error ${errObj.code ?? -1}`)
      );
      return;
    }
    req.resolve(msg.result);
  }
}
