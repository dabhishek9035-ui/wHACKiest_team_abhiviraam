// owner: M4 (D Venkata Abhishek, 1TD25CS079)
// purpose: shared types for the Local MCP server — error type with stable denial
//          codes, config shapes for local-scopes.json and command-allowlist.json,
//          and the uniform ToolResult shape returned by every tool.
// public interface it must expose: LocalToolError, ToolErrorCode, ToolResult,
//          LocalConfig, FsRootSpec, ResolvedRootSpec, CommandArgSpec, CommandEntry,
//          CommandAllowlist, ApprovalMeta.
// consumed by: server.ts, tools/*.ts, platform/windows.ts, tests.
// TODO: none (implemented).

/** Stable error codes. `denied` codes are policy refusals, never approvable. */
export type ToolErrorCode =
  | "config_invalid"
  | "path_outside_scope"
  | "path_traversal"
  | "symlink_escape"
  | "path_not_found"
  | "path_conflict"
  | "invalid_url"
  | "scheme_not_allowed"
  | "url_credentials_not_allowed"
  | "host_blocked"
  | "app_not_allowed"
  | "chrome_not_found"
  | "launch_failed"
  | "unknown_command"
  | "unknown_tool"
  | "invalid_args"
  | "elevation_not_supported"
  | "approval_required"
  | "approval_invalid"
  | "output_error"
  | "internal_error";

export class LocalToolError extends Error {
  constructor(
    public readonly code: ToolErrorCode,
    message: string,
    public readonly denied = true,
  ) {
    super(message);
    this.name = "LocalToolError";
  }
}

/** Uniform tool result — JSON-serializable, never contains file contents or secrets. */
export interface ToolResult {
  ok: boolean;
  tool?: string;
  code?: ToolErrorCode;
  denied?: boolean;
  message?: string;
  [key: string]: unknown;
}

export interface FsRootSpec {
  id: string;
  path: string; // may contain %VAR% references, expanded at load
  description?: string;
}

export interface ResolvedRoot {
  id: string;
  absolute: string;
  realpath: string;
  description?: string;
}

export interface LocalConfig {
  fsRoots: FsRootSpec[];
  defaultRootId?: string;
  urlPolicy: {
    schemes: string[];
    allowCredentials?: boolean;
    blockedHosts?: string[];
  };
  chromePath?: string;
  allowedApps: Record<string, { executable: string; args?: string[]; description?: string }>;
}

export interface CommandArgSpec {
  name: string;
  required?: boolean;
  /** Strict allowlist pattern the value must match (validated before use). */
  pattern?: string;
  /** Template for the argv element, e.g. "IMAGENAME eq {value}". Defaults to the raw value. */
  template?: string;
  description?: string;
}

export interface CommandEntry {
  id: string;
  description: string;
  purpose: string;
  impact: string;
  reversible?: boolean;
  executable: string;
  baseArgs?: string[];
  args: CommandArgSpec[];
  cwd?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
  /** Always false in shipped config; if ever true the server refuses (no elevation). */
  elevate?: boolean;
}

export interface CommandAllowlist {
  defaults?: { timeoutMs?: number; maxOutputBytes?: number; cwd?: string };
  commands: CommandEntry[];
}

/**
 * The reserved authorization field injected by M1 into the server-side MCP invocation
 * (_meta.penguApproval). Not a model-visible tool argument; never exposed to the UI.
 */
export interface ApprovalMeta {
  approvalId: string;
  tool: string;
  argsHash: string;
  expiresAt: string | number;
  mac: string;
}

/**
 * Everything the tool handlers need. Roots come pre-expanded (real paths resolved
 * at load); secret is the PENGU_APPROVAL_SECRET value; env is the process env used
 * for %VAR% expansion (injectable for tests).
 */
export interface ToolContext {
  roots: ResolvedRoot[];
  defaultRootId?: string;
  urlPolicy: LocalConfig["urlPolicy"];
  chromePath?: string;
  allowedApps: LocalConfig["allowedApps"];
  allowlist: CommandAllowlist;
  env: NodeJS.ProcessEnv;
  secret?: string;
  nowMs?: () => number;
}
