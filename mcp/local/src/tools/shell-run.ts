// owner: M4 (D Venkata Abhishek, 1TD25CS079)
// purpose: shell_run_restricted — the ONLY shell execution path in Pengu, and it is
//          an ALLOWLIST RUNNER, NOT A SANDBOX. CONSEQUENTIAL (A9): refuses without a
//          valid, unexpired HMAC approval token; unknown command IDs or invalid args
//          are denied even if a user would approve them. No free-form commands, no
//          string concatenation into a shell, fixed cwd, timeout, capped output,
//          minimal env (no secrets passed down), no elevation.
// public interface it must expose: runShell(ctx, args, approval?) -> ToolResult.
// consumed by: server.ts router.
// TODO: none (implemented).

import { spawnCapture } from "../platform/windows.js";
import { argsHashOf, verifyApprovalToken } from "../verify-token.js";
import {
  LocalToolError,
  type ApprovalMeta,
  type ToolContext,
  type ToolResult,
} from "../types.js";
import {
  resolveCwdFor,
  resolveCommandEntry,
  resolvedArgsFor,
  validateCommandArgs,
} from "./shell-describe.js";

const HARD_TIMEOUT_CAP_MS = 60_000;
const HARD_OUTPUT_CAP_BYTES = 1_000_000;

export async function runShell(
  ctx: ToolContext,
  args: { commandId?: unknown; args?: unknown },
  approval?: unknown,
): Promise<ToolResult> {
  // 1) Resolve the command entry — unknown IDs are denied, not approvable.
  const entry = resolveCommandEntry(ctx, args.commandId);

  // 2) Strict arg validation — bad args are denied, not approvable.
  const validated = validateCommandArgs(entry, args.args);

  // 3) Elevation is never supported.
  if (entry.elevate) {
    throw new LocalToolError("elevation_not_supported", "elevated commands are not supported");
  }

  // 4) Fixed cwd resolved from config only.
  const cwd = resolveCwdFor(ctx, entry);

  // 5) Verify the approval token against the EXACT resolved action (contract 7.3).
  const token = approval as ApprovalMeta | undefined;
  if (!token) {
    throw new LocalToolError(
      "approval_required",
      "shell_run_restricted requires an exact-action approval token injected by the agent (_meta.penguApproval)",
    );
  }
  if (!ctx.secret) {
    throw new LocalToolError(
      "approval_invalid",
      "server has no PENGU_APPROVAL_SECRET configured; refusing to run (fail closed)",
    );
  }
  const resolvedArgs = resolvedArgsFor(entry, entry.id, validated, cwd);
  const hash = argsHashOf(resolvedArgs);
  const verdict = verifyApprovalToken({
    token,
    expectedTool: "shell_run_restricted",
    expectedArgsHash: hash,
    secret: ctx.secret,
    nowMs: ctx.nowMs?.(),
  });
  if (!verdict.ok) {
    throw new LocalToolError("approval_invalid", `approval token refused: ${verdict.reason}`);
  }

  // 6) Execute under hard limits: fixed argv, no shell, timeout, output cap, minimal env.
  const timeoutMs = Math.min(entry.timeoutMs ?? ctx.allowlist.defaults?.timeoutMs ?? 15000, HARD_TIMEOUT_CAP_MS);
  const maxOutputBytes = Math.min(
    entry.maxOutputBytes ?? ctx.allowlist.defaults?.maxOutputBytes ?? 65536,
    HARD_OUTPUT_CAP_BYTES,
  );
  const argv = [...(entry.baseArgs ?? []), ...validated.argvValues];

  const outcome = await spawnCapture(entry.executable, argv, {
    cwd,
    timeoutMs,
    maxOutputBytes,
    env: ctx.env,
  });
  return {
    ok: true,
    tool: "shell_run_restricted",
    commandId: entry.id,
    cwd,
    exitCode: outcome.exitCode,
    signal: outcome.signal,
    timedOut: outcome.timedOut,
    truncated: outcome.truncated,
    durationMs: outcome.durationMs,
    stdoutHead: outcome.stdout,
    stderrHead: outcome.stderr,
    approvalId: token.approvalId,
    note: "capped summary only; full output is never returned or logged (allowlist runner, not a sandbox)",
  };
}
