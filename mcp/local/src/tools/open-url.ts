// owner: M4 (D Venkata Abhishek, 1TD25CS079)
// purpose: browser_open_url — open an HTTP/HTTPS URL in Chrome (ROUTINE).
//          Strict scheme allowlist from config (http/https only), rejects URLs with
//          embedded credentials and blocked hosts. Launch state is not locally
//          verifiable, so callers must record the side effect as intent-only and
//          mark verification "unknown" on resume.
// public interface it must expose: openUrl(ctx, args) -> ToolResult.
// consumed by: server.ts router.
// TODO: none (implemented).

import { openInChrome } from "../platform/windows.js";
import { LocalToolError, type ToolContext, type ToolResult } from "../types.js";

export function openUrl(ctx: ToolContext, args: { url?: unknown }): ToolResult {
  if (typeof args.url !== "string" || args.url.trim() === "") {
    throw new LocalToolError("invalid_url", "browser_open_url: 'url' is required");
  }
  let parsed: URL;
  try {
    parsed = new URL(args.url.trim());
  } catch {
    throw new LocalToolError("invalid_url", "browser_open_url: not a valid URL");
  }

  const schemes = ctx.urlPolicy.schemes.length > 0 ? ctx.urlPolicy.schemes : ["http:", "https:"];
  if (!schemes.includes(parsed.protocol)) {
    throw new LocalToolError("scheme_not_allowed", `scheme ${parsed.protocol} is not allowed`);
  }
  if (!ctx.urlPolicy.allowCredentials && (parsed.username || parsed.password)) {
    throw new LocalToolError("url_credentials_not_allowed", "URLs with embedded credentials are refused");
  }
  const blocked = (ctx.urlPolicy.blockedHosts ?? []).map((h) => h.toLowerCase());
  if (blocked.includes(parsed.hostname.toLowerCase())) {
    throw new LocalToolError("host_blocked", "host is blocked by policy");
  }

  const { pid } = openInChrome(parsed.toString(), ctx.chromePath, ctx.env);
  const result: ToolResult = {
    ok: true,
    tool: "browser_open_url",
    url: parsed.toString(),
    openedIn: "chrome",
    verifiable: false,
    note: "launch observed locally only; whether the page actually loaded cannot be verified, so resume treats this as unknown",
  };
  if (pid !== undefined) result.pid = pid;
  return result;
}
