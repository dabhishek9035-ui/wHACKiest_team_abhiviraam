// owner: M4 (D Venkata Abhishek, 1TD25CS079)
// purpose: fs_list_dir — list one directory inside an approved root (READ).
//          Returns names and entry types only, capped count; never reads or returns
//          file contents (M4 rule: never log file contents).
// public interface it must expose: listDir(ctx, args) -> ToolResult.
// consumed by: server.ts router.
// TODO: none (implemented).

import { listDirectory, resolveWithinRoots, statIsDirectory } from "../platform/windows.js";
import { LocalToolError, type ToolContext, type ToolResult } from "../types.js";

export function listDir(ctx: ToolContext, args: { path?: unknown; rootId?: unknown; limit?: unknown }): ToolResult {
  if (typeof args.path !== "string" || args.path.trim() === "") {
    throw new LocalToolError("path_outside_scope", "fs_list_dir: 'path' is required");
  }
  const rootId = typeof args.rootId === "string" ? args.rootId : undefined;
  const limit =
    typeof args.limit === "number" && Number.isFinite(args.limit)
      ? Math.min(Math.max(1, Math.trunc(args.limit)), 500)
      : 200;

  const { target, root } = resolveWithinRoots(ctx.roots, ctx.defaultRootId, args.path, {
    rootId,
    mustExist: true,
  });
  if (!statIsDirectory(target)) {
    throw new LocalToolError("path_not_found", "path is not a directory");
  }

  const { entries, truncated } = listDirectory(target, limit);
  return {
    ok: true,
    tool: "fs_list_dir",
    rootId: root.id,
    path: target,
    count: entries.length,
    truncated,
    entries,
    note: "names and types only; file contents are never read",
  };
}
