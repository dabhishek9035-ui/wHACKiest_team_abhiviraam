// owner: M4 (D Venkata Abhishek, 1TD25CS079)
// purpose: Pengu Local MCP server (stdio) — scoped fs_create_folder/fs_list_dir,
//          browser_open_url (HTTP/HTTPS in Chrome), allowlisted app_launch,
//          shell_describe_command and the consequential shell_run_restricted.
//          Deny by default: anything not explicitly allowlisted or in-scope fails
//          closed. Config lives ONLY in config/*.json (no hardcoded paths).
//          The approval token arrives via the reserved request _meta field injected
//          by M1 server-side; the model and UI never see it.
// public interface it must expose: createLocalServerCore(deps) with callTool/manifest,
//          loadLocalConfig, loadCommandAllowlist, buildMcpServer, main (stdio entry).
// consumed by: M1 agent spawns this over stdio (servers.config.json); M4 tests/scripts.
// TODO: none (implemented).

import { mkdirSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve as resolvePath } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { expandEnvVars } from "./platform/windows.js";
import type {
  ApprovalMeta,
  CommandAllowlist,
  LocalConfig,
  ResolvedRoot,
  ToolResult,
} from "./types.js";
import { LocalToolError } from "./types.js";
import { createFolder } from "./tools/create-folder.js";
import { listDir } from "./tools/list-dir.js";
import { openUrl } from "./tools/open-url.js";
import { launchAppTool } from "./tools/launch-app.js";
import { describeCommand } from "./tools/shell-describe.js";
import { runShell } from "./tools/shell-run.js";

const here = dirname(fileURLToPath(import.meta.url)); // dist/ or src/
const PACKAGE_ROOT = dirname(here);

// ---------------------------------------------------------------------------
// config loading (config files are the single source of truth for paths/scopes)
// ---------------------------------------------------------------------------

export function loadLocalConfig(configDir: string, env: NodeJS.ProcessEnv): LocalConfig {
  const raw = JSON.parse(readFileSync(join(configDir, "local-scopes.json"), "utf8")) as LocalConfig;
  if (!Array.isArray(raw.fsRoots) || raw.fsRoots.length === 0) {
    throw new LocalToolError("config_invalid", "local-scopes.json must define at least one fsRoot");
  }
  if (!raw.urlPolicy || !Array.isArray(raw.urlPolicy.schemes)) {
    throw new LocalToolError("config_invalid", "local-scopes.json must define urlPolicy.schemes");
  }
  if (typeof raw.allowedApps !== "object" || raw.allowedApps === null) {
    throw new LocalToolError("config_invalid", "local-scopes.json must define allowedApps (may be {})");
  }
  return raw;
}

export function loadCommandAllowlist(configDir: string): CommandAllowlist {
  const raw = JSON.parse(readFileSync(join(configDir, "command-allowlist.json"), "utf8")) as CommandAllowlist;
  if (!Array.isArray(raw.commands)) {
    throw new LocalToolError("config_invalid", "command-allowlist.json must define commands: []");
  }
  return raw;
}

/** Expands %VAR% paths, creates missing granted roots, and resolves real paths. */
export function resolveRoots(config: LocalConfig, env: NodeJS.ProcessEnv): ResolvedRoot[] {
  const roots: ResolvedRoot[] = [];
  for (const spec of config.fsRoots) {
    const absolute = expandEnvVars(spec.path, env);
    // The user granted this directory at setup; creating it when missing is part of
    // that grant (A11 works out of the box on a fresh machine).
    mkdirSync(absolute, { recursive: true });
    let realpath: string;
    try {
      realpath = realpathSync.native(absolute);
    } catch {
      throw new LocalToolError(
        "config_invalid",
        `fsRoot '${spec.id}' could not be created: ${absolute}`,
      );
    }
    const root: ResolvedRoot = { id: spec.id, absolute, realpath };
    if (spec.description) root.description = spec.description;
    roots.push(root);
  }
  return roots;
}

// ---------------------------------------------------------------------------
// server core (transport-independent; used by the MCP layer, tests and scripts)
// ---------------------------------------------------------------------------

export interface LocalServerDeps {
  configDir?: string;
  config?: LocalConfig;
  allowlist?: CommandAllowlist;
  secret?: string;
  env?: NodeJS.ProcessEnv;
  nowMs?: () => number;
}

export interface LocalServerCore {
  callTool(name: string, args: Record<string, unknown>, approval?: unknown): Promise<ToolResult>;
  manifest(): unknown;
  roots(): ResolvedRoot[];
}

export function createLocalServerCore(deps: LocalServerDeps = {}): LocalServerCore {
  const env = deps.env ?? process.env;
  const configDir = deps.configDir ?? process.env.PENGU_LOCAL_MCP_CONFIG ?? join(PACKAGE_ROOT, "config");
  const config = deps.config ?? loadLocalConfig(configDir, env);
  const allowlist = deps.allowlist ?? loadCommandAllowlist(configDir);
  const roots = resolveRoots(config, env);
  const ctx = {
    roots,
    defaultRootId: config.defaultRootId,
    urlPolicy: config.urlPolicy,
    chromePath: config.chromePath,
    allowedApps: config.allowedApps,
    allowlist,
    env,
    secret: deps.secret,
    nowMs: deps.nowMs,
  };

  const toolNames = [
    "fs_create_folder",
    "fs_list_dir",
    "browser_open_url",
    "app_launch",
    "shell_describe_command",
    "shell_run_restricted",
  ] as const;

  async function callTool(
    name: string,
    args: Record<string, unknown>,
    approval?: unknown,
  ): Promise<ToolResult> {
    try {
      switch (name) {
        case "fs_create_folder":
          return createFolder(ctx, args);
        case "fs_list_dir":
          return listDir(ctx, args);
        case "browser_open_url":
          return openUrl(ctx, args);
        case "app_launch":
          return launchAppTool(ctx, args);
        case "shell_describe_command":
          return describeCommand(ctx, args);
        case "shell_run_restricted":
          return await runShell(ctx, args, approval);
        default:
          throw new LocalToolError("unknown_tool", `unknown tool '${name}'`);
      }
    } catch (err) {
      if (err instanceof LocalToolError) {
        return { ok: false, tool: name, code: err.code, denied: err.denied, message: err.message };
      }
      return { ok: false, tool: name, code: "internal_error", message: String(err) };
    }
  }

  function manifest(): unknown {
    try {
      return JSON.parse(readFileSync(join(PACKAGE_ROOT, "tool-manifest.json"), "utf8"));
    } catch (err) {
      throw new LocalToolError("config_invalid", `tool-manifest.json missing/unreadable: ${String(err)}`);
    }
  }

  return { callTool, manifest, roots: () => roots };
}

// ---------------------------------------------------------------------------
// MCP stdio transport
// ---------------------------------------------------------------------------

/** Approval meta from the reserved request _meta field (injected by M1, not the model). */
function approvalFromExtra(extra: { _meta?: Record<string, unknown> | undefined }): unknown {
  const meta = extra?._meta;
  if (!meta) return undefined;
  const token = meta["penguApproval"];
  if (!token || typeof token !== "object") return undefined;
  const t = token as Partial<ApprovalMeta>;
  if (
    typeof t.approvalId !== "string" ||
    typeof t.tool !== "string" ||
    typeof t.argsHash !== "string" ||
    (typeof t.expiresAt !== "string" && typeof t.expiresAt !== "number") ||
    typeof t.mac !== "string"
  ) {
    return undefined; // malformed token => treated as missing => refusal below
  }
  return token;
}

export function buildMcpServer(core: LocalServerCore): McpServer {
  const server = new McpServer({ name: "pengu-local-mcp", version: "0.1.0" });

  const toCallToolResult = (result: ToolResult) => ({
    isError: !result.ok,
    content: [{ type: "text" as const, text: JSON.stringify(result) }],
  });

  const register = (
    name: string,
    description: string,
    schema: z.ZodRawShape,
    run: (args: Record<string, unknown>, extra: { _meta?: Record<string, unknown> }) => Promise<ToolResult>,
  ): void => {
    server.registerTool(
      name,
      { description, inputSchema: schema },
      async (args: Record<string, unknown>, extra: { _meta?: Record<string, unknown> }) =>
        toCallToolResult(await run(args, extra)),
    );
  };

  register(
    "fs_create_folder",
    "Create a folder inside an approved root (ROUTINE, idempotent; traversal/symlink escapes are rejected).",
    { path: z.string(), rootId: z.string().optional() },
    async (args) => core.callTool("fs_create_folder", args),
  );
  register(
    "fs_list_dir",
    "List one directory inside an approved root (READ; names/types only, capped).",
    { path: z.string(), rootId: z.string().optional(), limit: z.number().optional() },
    async (args) => core.callTool("fs_list_dir", args),
  );
  register(
    "browser_open_url",
    "Open an HTTP/HTTPS URL in Chrome (ROUTINE; other schemes refused).",
    { url: z.string() },
    async (args) => core.callTool("browser_open_url", args),
  );
  register(
    "app_launch",
    "Launch an allowlisted application by app ID (ROUTINE; unknown IDs denied).",
    { appId: z.string() },
    async (args) => core.callTool("app_launch", args),
  );
  register(
    "shell_describe_command",
    "Describe an allowlisted command ID (READ): purpose, resolved cwd, argv, impact, reversibility.",
    { commandId: z.string(), args: z.record(z.string(), z.string()).optional() },
    async (args) => core.callTool("shell_describe_command", args),
  );
  register(
    "shell_run_restricted",
    "Run an allowlisted command ID (CONSEQUENTIAL): requires an exact-action approval token in _meta; unknown commands or bad args are denied.",
    { commandId: z.string(), args: z.record(z.string(), z.string()).optional() },
    async (args, extra) => core.callTool("shell_run_restricted", args, approvalFromExtra(extra)),
  );

  return server;
}

/** stdio entrypoint: `node dist/server.js`. Logs go to stderr only; stdout is MCP protocol. */
export async function main(): Promise<void> {
  const configDir = process.env.PENGU_LOCAL_MCP_CONFIG ?? join(PACKAGE_ROOT, "config");
  const core = createLocalServerCore({
    configDir,
    secret: process.env.PENGU_APPROVAL_SECRET,
  });
  const server = buildMcpServer(core);
  await server.connect(new StdioServerTransport());
  console.error(`pengu-local-mcp: ready (stdio; config=${configDir})`);
  console.error("pengu-local-mcp: allowlist runner, not a sandbox");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolvePath(process.argv[1])).href) {
  main().catch((err) => {
    console.error(`pengu-local-mcp: fatal: ${String(err)}`);
    process.exit(1);
  });
}
