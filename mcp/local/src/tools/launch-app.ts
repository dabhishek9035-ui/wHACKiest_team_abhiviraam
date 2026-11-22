// owner: M4 (D Venkata Abhishek, 1TD25CS079)
// purpose: app_launch — launch an allowlisted application by its configured app ID
//          (ROUTINE). Unknown IDs are denied (fail closed). Launch state is not
//          locally verifiable, so resume marks it "unknown" and asks the user
//          instead of blindly relaunching.
// public interface it must expose: launchAppTool(ctx, args) -> ToolResult.
// consumed by: server.ts router.
// TODO: none (implemented).

import { launchApp } from "../platform/windows.js";
import { LocalToolError, type ToolContext, type ToolResult } from "../types.js";

export function launchAppTool(ctx: ToolContext, args: { appId?: unknown }): ToolResult {
  if (typeof args.appId !== "string" || args.appId.trim() === "") {
    throw new LocalToolError("app_not_allowed", "app_launch: 'appId' is required");
  }
  const appId = args.appId.trim();
  const spec = ctx.allowedApps[appId];
  if (!spec || typeof spec.executable !== "string") {
    throw new LocalToolError("app_not_allowed", `app id '${appId}' is not on the allowlist`);
  }

  const { pid } = launchApp(appId, { executable: spec.executable, args: spec.args }, ctx.env);
  const result: ToolResult = {
    ok: true,
    tool: "app_launch",
    appId,
    verifiable: false,
    note: "launch observed locally only; the app window state cannot be verified, so resume treats this as unknown",
  };
  if (pid !== undefined) result.pid = pid;
  return result;
}
