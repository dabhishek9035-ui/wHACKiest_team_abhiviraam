// owner: M4 (D Venkata Abhishek, 1TD25CS079)
// purpose: fs_create_folder — create a directory inside an approved root only.
//          ROUTINE within a granted root (no per-task approval). Resolves real paths,
//          rejects `..` traversal and symlink escapes, and is idempotent: an existing
//          directory returns success with alreadyExisted:true (duplicate-safe).
// public interface it must expose: createFolder(ctx, args) -> ToolResult.
// consumed by: server.ts router.
// TODO: none (implemented).

import { existsSync, mkdirSync, statSync, realpathSync } from "node:fs";
import { resolveWithinRoots, isPathInside } from "../platform/windows.js";
import { LocalToolError, type ToolResult, type ToolContext } from "../types.js";

export function createFolder(
  ctx: ToolContext,
  args: { path?: unknown; rootId?: unknown },
): ToolResult {
  if (typeof args.path !== "string" || args.path.trim() === "") {
    throw new LocalToolError("path_outside_scope", "fs_create_folder: 'path' is required");
  }
  const rootId = typeof args.rootId === "string" ? args.rootId : undefined;

  // Resolve against approved roots: rejects traversal and symlink escapes (fail closed).
  const { target, root } = resolveWithinRoots(ctx.roots, ctx.defaultRootId, args.path, { rootId });

  const existedBefore = existsSync(target);
  if (existedBefore && !statSync(target).isDirectory()) {
    throw new LocalToolError("path_conflict", "path exists and is not a directory");
  }
  if (!existedBefore) {
    mkdirSync(target, { recursive: true });
  }

  // Re-verify containment against the real path after creation (symlink hardening).
  const realNow = realpathSync.native(target);
  if (!isPathInside(root.realpath, realNow)) {
    throw new LocalToolError("symlink_escape", "created path escaped the approved root");
  }

  return {
    ok: true,
    tool: "fs_create_folder",
    path: target,
    rootId: root.id,
    alreadyExisted: existedBefore,
    verifiable: true,
  };
}
