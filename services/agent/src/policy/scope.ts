/**
 * owner: M1 (Ronit Kapar)
 * purpose: Granted-scope verification for Gmail, filesystem roots, HTTP(S) URLs, allowlisted apps, and allowlisted shell commands.
 */

import path from "node:path";
import type { ToolManifestEntry } from "@pengu/contracts";

export interface ScopeConfig {
  /** Setup-level granted scopes (e.g. "gmail:read", "gmail:compose", "gmail:send", "fs:approved_roots", "browser:http_https", "app:allowlist", "shell:allowlist"). */
  grantedScopes: string[];
  /** Approved root directories for fs_create_folder and fs_list_dir. */
  approvedRoots: string[];
  /** Allowlisted application IDs for app_launch. */
  allowlistedApps: string[];
  /** Allowlisted command IDs for shell_describe_command and shell_run_restricted. */
  allowlistedShellCommands: string[];
}

export interface ScopeCheckResult {
  inScope: boolean;
  reason: string;
}

function normalizeForComparison(p: string): string {
  // Normalize Windows & POSIX separators for cross-platform safety checks
  const replaced = p.replace(/\\/g, "/");
  const normalized = path.posix.normalize(replaced).replace(/\/+$/, "");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

export function isPathInsideApprovedRoots(
  targetPath: string,
  approvedRoots: string[]
): boolean {
  if (!targetPath || approvedRoots.length === 0) return false;
  const normTarget = normalizeForComparison(targetPath);
  return approvedRoots.some((root) => {
    const normRoot = normalizeForComparison(root);
    return normTarget === normRoot || normTarget.startsWith(`${normRoot}/`);
  });
}

export function checkScope(
  manifest: ToolManifestEntry,
  args: Record<string, unknown>,
  config: ScopeConfig
): ScopeCheckResult {
  if (!manifest.scope || !config.grantedScopes.includes(manifest.scope)) {
    return {
      inScope: false,
      reason: `Scope '${manifest.scope || "unspecified"}' has not been granted for tool '${manifest.name}'.`,
    };
  }

  if (manifest.name === "fs_create_folder" || manifest.name === "fs_list_dir") {
    const targetPath = typeof args.path === "string" ? args.path : "";
    if (!targetPath) {
      return {
        inScope: false,
        reason: `Tool '${manifest.name}' requires a target 'path' inside an approved directory.`,
      };
    }
    if (!isPathInsideApprovedRoots(targetPath, config.approvedRoots)) {
      return {
        inScope: false,
        reason: `Path '${targetPath}' is outside approved directory roots.`,
      };
    }
  }

  if (manifest.name === "browser_open_url") {
    const rawUrl = typeof args.url === "string" ? args.url : "";
    try {
      const parsed = new URL(rawUrl);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return {
          inScope: false,
          reason: `URL protocol '${parsed.protocol}' is not allowed; only http/https URLs are permitted.`,
        };
      }
    } catch {
      return {
        inScope: false,
        reason: `Invalid URL '${rawUrl}' for browser_open_url.`,
      };
    }
  }

  if (manifest.name === "app_launch") {
    const appId = typeof args.appId === "string" ? args.appId : "";
    if (!appId || !config.allowlistedApps.includes(appId)) {
      return {
        inScope: false,
        reason: `Application '${appId || "<empty>"}' is not in the allowlisted applications list.`,
      };
    }
  }

  if (
    manifest.name === "shell_run_restricted" ||
    manifest.name === "shell_describe_command"
  ) {
    const commandId = typeof args.commandId === "string" ? args.commandId : "";
    if (!commandId || !config.allowlistedShellCommands.includes(commandId)) {
      return {
        inScope: false,
        reason: `Shell commandId '${commandId || "<empty>"}' is not in the allowlist and cannot be approved.`,
      };
    }
  }

  return {
    inScope: true,
    reason: `Tool '${manifest.name}' passed scope verification for '${manifest.scope}'.`,
  };
}
