/**
 * owner: M1 (Ronit Kapar)
 * purpose: MCP tool registry loading servers.config.json and each server's tool-manifest.json, validating arguments, and stripping reserved auth fields from LLM schemas.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  RESERVED_APPROVAL_TOKEN_FIELD,
  type SignedApprovalToken,
  type ToolCallResult,
  type ToolManifest,
  type ToolManifestEntry,
} from "@pengu/contracts";
import {
  McpStdioClient,
  type McpServerConnection,
  type McpToolDescriptor,
} from "./client.js";

export interface RegisteredTool {
  server: string;
  name: string;
  description: string;
  manifest: ToolManifestEntry;
  inputSchema: Record<string, unknown>;
}

export interface ServerConfigEntry {
  id: string;
  command: string;
  args: string[];
  manifestPath: string;
  enabled?: boolean;
}

export interface ServersConfigFile {
  servers: ServerConfigEntry[];
}

export interface ModelVisibleToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export class McpToolRegistry {
  private readonly connections = new Map<string, McpServerConnection>();
  private readonly tools = new Map<string, RegisteredTool>();

  async registerServer(
    connection: McpServerConnection,
    manifest: ToolManifest
  ): Promise<RegisteredTool[]> {
    if (!connection.isConnected()) {
      await connection.connect();
    }
    this.connections.set(connection.serverId, connection);

    const listed: McpToolDescriptor[] = await connection.listTools();
    const manifestByName = new Map<string, ToolManifestEntry>();
    for (const entry of manifest.tools) {
      manifestByName.set(entry.name, entry);
    }

    const registered: RegisteredTool[] = [];
    for (const descriptor of listed) {
      const entry = manifestByName.get(descriptor.name);
      // Fail closed: tools exposed by a server without a manifest entry are NOT registered.
      if (!entry) continue;

      const rawSchema =
        (descriptor.inputSchema as Record<string, unknown> | undefined) ??
        (entry.inputSchema as unknown as Record<string, unknown> | undefined) ?? {
          type: "object",
          properties: {},
          additionalProperties: true,
        };

      const sanitizedSchema = this.stripReservedFieldsFromSchema(rawSchema);

      const reg: RegisteredTool = {
        server: connection.serverId,
        name: descriptor.name,
        description: entry.description || descriptor.description || "",
        manifest: entry,
        inputSchema: sanitizedSchema,
      };
      this.tools.set(reg.name, reg);
      registered.push(reg);
    }

    return registered;
  }

  async loadFromConfigFile(configPath: string): Promise<void> {
    const raw = await readFile(configPath, "utf8");
    const parsed = JSON.parse(raw) as ServersConfigFile;
    const baseDir = path.dirname(configPath);

    for (const server of parsed.servers) {
      if (server.enabled === false) continue;
      const manifestAbs = path.resolve(baseDir, server.manifestPath);
      const manifestRaw = await readFile(manifestAbs, "utf8");
      const manifest = JSON.parse(manifestRaw) as ToolManifest;
      const resolvedArgs = server.args.map((arg) =>
        arg.startsWith(".") ? path.resolve(baseDir, arg) : arg
      );
      const conn = new McpStdioClient({
        serverId: server.id,
        command: server.command,
        args: resolvedArgs,
      });
      await this.registerServer(conn, manifest);
    }
  }

  getTool(toolName: string): RegisteredTool | undefined {
    return this.tools.get(toolName);
  }

  listRegisteredTools(): RegisteredTool[] {
    return Array.from(this.tools.values());
  }

  isServerConnected(serverId: string): boolean {
    return this.connections.get(serverId)?.isConnected() ?? false;
  }

  /**
   * Returns OpenAI-compatible tool definitions safe to pass to GLM.
   * Reserved authorization fields are guaranteed to be absent.
   */
  getModelVisibleTools(): ModelVisibleToolDefinition[] {
    return this.listRegisteredTools().map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: `[${t.manifest.riskClass}] ${t.description}`,
        parameters: t.inputSchema,
      },
    }));
  }

  validateToolArgs(
    toolName: string,
    args: Record<string, unknown>
  ): { valid: boolean; reason?: string } {
    const reg = this.tools.get(toolName);
    if (!reg) {
      return { valid: false, reason: `Unknown tool '${toolName}'.` };
    }
    if (RESERVED_APPROVAL_TOKEN_FIELD in args) {
      return {
        valid: false,
        reason: `Reserved field '${RESERVED_APPROVAL_TOKEN_FIELD}' cannot be supplied in tool arguments.`,
      };
    }
    const required = reg.inputSchema.required;
    if (Array.isArray(required)) {
      for (const reqKey of required) {
        if (typeof reqKey === "string" && !(reqKey in args)) {
          return {
            valid: false,
            reason: `Missing required argument '${reqKey}' for tool '${toolName}'.`,
          };
        }
      }
    }
    return { valid: true };
  }

  async invokeTool(
    toolName: string,
    args: Record<string, unknown>,
    approvalToken?: SignedApprovalToken
  ): Promise<ToolCallResult> {
    const reg = this.tools.get(toolName);
    if (!reg) {
      return {
        ok: false,
        error: {
          code: "UNKNOWN_TOOL",
          message: `Tool '${toolName}' is not registered in McpToolRegistry.`,
        },
      };
    }
    const validation = this.validateToolArgs(toolName, args);
    if (!validation.valid) {
      return {
        ok: false,
        error: {
          code: "INVALID_TOOL_ARGS",
          message: validation.reason ?? "Invalid tool arguments.",
        },
      };
    }
    const conn = this.connections.get(reg.server);
    if (!conn || !conn.isConnected()) {
      return {
        ok: false,
        error: {
          code: "SERVER_UNAVAILABLE",
          message: `MCP server '${reg.server}' is not connected.`,
        },
      };
    }
    return conn.callTool(toolName, args, approvalToken);
  }

  async closeAll(): Promise<void> {
    for (const conn of this.connections.values()) {
      await conn.close();
    }
    this.connections.clear();
  }

  private stripReservedFieldsFromSchema(
    schema: Record<string, unknown>
  ): Record<string, unknown> {
    const copy: Record<string, unknown> = { ...schema };
    if (copy.properties && typeof copy.properties === "object") {
      const props = { ...(copy.properties as Record<string, unknown>) };
      delete props[RESERVED_APPROVAL_TOKEN_FIELD];
      copy.properties = props;
    }
    if (Array.isArray(copy.required)) {
      copy.required = copy.required.filter(
        (k) => k !== RESERVED_APPROVAL_TOKEN_FIELD
      );
    }
    return copy;
  }
}
