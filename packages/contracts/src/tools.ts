/**
 * owner: M1 (Ronit Kapar)
 * purpose: Frozen MCP tool manifest, risk classification, and untrusted-content contracts (Section 7.2).
 */

export type RiskClass = "READ" | "ROUTINE" | "CONSEQUENTIAL";

export type McpServerId = "gmail" | "local";

export const CANONICAL_TOOLS = {
  GMAIL_SEARCH_THREADS: "gmail_search_threads",
  GMAIL_READ_THREAD: "gmail_read_thread",
  GMAIL_CREATE_DRAFT: "gmail_create_draft",
  GMAIL_GET_DRAFT: "gmail_get_draft",
  GMAIL_SEND_DRAFT: "gmail_send_draft",
  FS_LIST_DIR: "fs_list_dir",
  FS_CREATE_FOLDER: "fs_create_folder",
  BROWSER_OPEN_URL: "browser_open_url",
  APP_LAUNCH: "app_launch",
  SHELL_DESCRIBE_COMMAND: "shell_describe_command",
  SHELL_RUN_RESTRICTED: "shell_run_restricted",
} as const;

export type CanonicalToolName =
  (typeof CANONICAL_TOOLS)[keyof typeof CANONICAL_TOOLS];

export interface JsonSchemaObject {
  type: "object";
  properties?: Record<string, Record<string, unknown>>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface ToolManifestEntry {
  name: string;
  description: string;
  riskClass: RiskClass;
  scope: string;
  sideEffect: boolean;
  idempotent: boolean;
  reversible: boolean;
  /** READ tool invoked by M1 to build an exact, reviewable approval preview. */
  previewTool?: string;
  requiresApprovalToken: boolean;
  inputSchema?: JsonSchemaObject;
}

export interface ToolManifest {
  server: McpServerId | string;
  version: string;
  tools: ToolManifestEntry[];
}

/**
 * Mandatory wrapper for any tool output carrying external/untrusted data
 * (email bodies, attachments, web pages, external files).
 */
export interface UntrustedToolResult<T = unknown> {
  untrusted: true;
  source?: string;
  content: T;
}

export interface ToolCallRequest {
  server: string;
  tool: string;
  args: Record<string, unknown>;
}

export interface ToolCallResult {
  ok: boolean;
  data?: unknown;
  untrusted?: boolean;
  error?: {
    code: string;
    message: string;
  };
}

export function isUntrustedResult(value: unknown): value is UntrustedToolResult {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<string, unknown>).untrusted === true &&
    "content" in (value as Record<string, unknown>)
  );
}
