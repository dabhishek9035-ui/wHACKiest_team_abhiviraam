/**
 * owner: M1 (Ronit Kapar)
 * purpose: Hard-deny rules enforced before classification or approval. Denied actions are NEVER approvable.
 */

import { RESERVED_APPROVAL_TOKEN_FIELD } from "@pengu/contracts";

export interface HardDenyContext {
  tool: string;
  args: Record<string, unknown>;
  allowlistedShellCommands: string[];
  /** Provenance flag: tool calls originating from untrusted external content are always denied. */
  origin?: "trusted_user" | "untrusted_content";
}

export interface HardDenyResult {
  denied: boolean;
  code?: string;
  reason?: string;
}

const FORBIDDEN_SHELL_PATTERNS = [
  ";",
  "&&",
  "||",
  "`",
  "$(",
  "|",
  ">",
  "<",
  "\n",
  "\r",
];

function containsShellMetacharacters(value: unknown): boolean {
  if (typeof value === "string") {
    return FORBIDDEN_SHELL_PATTERNS.some((pat) => value.includes(pat));
  }
  if (Array.isArray(value)) {
    return value.some(containsShellMetacharacters);
  }
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).some(
      containsShellMetacharacters
    );
  }
  return false;
}

export function evaluateHardDeny(ctx: HardDenyContext): HardDenyResult {
  // 1. Untrusted external content can never trigger a tool call or grant permission.
  if (ctx.origin === "untrusted_content") {
    return {
      denied: true,
      code: "UNTRUSTED_ORIGIN_DENIED",
      reason:
        "Untrusted external content (email/web/file data) cannot invoke tools or modify execution.",
    };
  }

  // 2. Reject any attempt by the model or caller to supply the reserved approval token field.
  if (RESERVED_APPROVAL_TOKEN_FIELD in ctx.args) {
    return {
      denied: true,
      code: "RESERVED_AUTH_FIELD_FORBIDDEN",
      reason: `Tool arguments may not include reserved authorization field '${RESERVED_APPROVAL_TOKEN_FIELD}'.`,
    };
  }

  // 3. Reject unknown or unsafe shell commands — never made safe by user approval.
  if (
    ctx.tool === "shell_run_restricted" ||
    ctx.tool === "shell_describe_command"
  ) {
    if ("command" in ctx.args || "rawCommand" in ctx.args || "script" in ctx.args) {
      return {
        denied: true,
        code: "FREEFORM_SHELL_DENIED",
        reason:
          "Free-form PowerShell commands are forbidden. Only allowlisted commandId entries with validated args are permitted.",
      };
    }
    const commandId = typeof ctx.args.commandId === "string" ? ctx.args.commandId : "";
    if (!commandId || !ctx.allowlistedShellCommands.includes(commandId)) {
      return {
        denied: true,
        code: "UNKNOWN_SHELL_COMMAND_DENIED",
        reason: `Unknown or unapproved shell commandId '${commandId || "<empty>"}' is hard-denied and cannot be approved.`,
      };
    }
    if (containsShellMetacharacters(ctx.args.args)) {
      return {
        denied: true,
        code: "UNSAFE_SHELL_ARGS_DENIED",
        reason:
          "Shell arguments contain forbidden shell metacharacters and are hard-denied.",
      };
    }
  }

  // 4. Reject path traversal or null bytes in filesystem arguments.
  if (ctx.tool === "fs_create_folder" || ctx.tool === "fs_list_dir") {
    const targetPath = typeof ctx.args.path === "string" ? ctx.args.path : "";
    if (
      targetPath.includes("\0") ||
      /(^|[\\/])\.\.([\\/]|$)/.test(targetPath)
    ) {
      return {
        denied: true,
        code: "PATH_TRAVERSAL_DENIED",
        reason: `Path '${targetPath}' contains forbidden traversal segments or null bytes.`,
      };
    }
  }

  // 5. Reject dangerous URL schemes in browser_open_url.
  if (ctx.tool === "browser_open_url") {
    const url = typeof ctx.args.url === "string" ? ctx.args.url.trim() : "";
    if (!/^https?:\/\//i.test(url)) {
      return {
        denied: true,
        code: "UNSAFE_URL_SCHEME_DENIED",
        reason: `Only http:// and https:// URLs are allowed for browser_open_url.`,
      };
    }
  }

  return { denied: false };
}
