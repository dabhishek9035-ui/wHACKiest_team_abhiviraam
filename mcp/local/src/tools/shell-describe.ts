// owner: M4 (D Venkata Abhishek, 1TD25CS079)
// purpose: shell_describe_command — READ tool that resolves an allowlisted command ID
//          into the exact-action approval preview: purpose, resolved cwd, argv,
//          impact, reversibility, timeout and output cap. Unknown command IDs or bad
//          args are DENIED here — denied actions are not approvable (A9). This is also
//          the previewTool for shell_run_restricted (contract 7.2).
// public interface it must expose: resolveCommandEntry, validateCommandArgs,
//          resolveCwdFor, resolvedArgsFor, describeCommand(ctx, args).
// consumed by: server.ts router, shell-run.ts.
// TODO: none (implemented).

import { existsSync } from "node:fs";
import path from "node:path";
import { expandEnvVars } from "../platform/windows.js";
import {
  LocalToolError,
  type CommandEntry,
  type ToolContext,
  type ToolResult,
} from "../types.js";

export function resolveCommandEntry(ctx: ToolContext, commandId: unknown): CommandEntry {
  if (typeof commandId !== "string" || commandId.trim() === "") {
    throw new LocalToolError("unknown_command", "commandId is required");
  }
  const entry = ctx.allowlist.commands.find((c) => c.id === commandId.trim());
  if (!entry) {
    throw new LocalToolError(
      "unknown_command",
      `command id '${commandId}' is not on the allowlist; denied and not approvable`,
    );
  }
  return entry;
}

export interface ValidatedArgs {
  values: Record<string, string>;
  argvValues: string[];
}

/** Validates provided args strictly against the entry's arg specs (deny by default). */
export function validateCommandArgs(entry: CommandEntry, args: unknown): ValidatedArgs {
  const provided = (args ?? {}) as Record<string, unknown>;
  const values: Record<string, string> = {};
  const argvValues: string[] = [];
  const problems: string[] = [];

  for (const spec of entry.args ?? []) {
    const raw = provided[spec.name];
    if (raw === undefined || raw === null) {
      if (spec.required) {
        problems.push(`missing required argument '${spec.name}'`);
      } else {
        continue;
      }
    } else if (typeof raw !== "string") {
      problems.push(`argument '${spec.name}' must be a string`);
      continue;
    } else {
      const value = raw;
      if (spec.pattern && !new RegExp(spec.pattern).test(value)) {
        problems.push(`argument '${spec.name}' does not match the allowed pattern`);
        continue;
      }
      values[spec.name] = value;
      argvValues.push(spec.template ? spec.template.replace("{value}", value) : value);
    }
    // Only declared args exist; anything else is rejected below.
  }

  for (const name of Object.keys(provided)) {
    if (!(entry.args ?? []).some((s) => s.name === name)) {
      problems.push(`unknown argument '${name}'`);
    }
  }

  if (problems.length > 0) {
    throw new LocalToolError(
      "invalid_args",
      `invalid arguments for '${entry.id}' (denied, not approvable): ${problems.join("; ")}`,
    );
  }
  return { values, argvValues };
}

/** Fixed working directory for an entry (config only — never hardcoded in code). */
export function resolveCwdFor(ctx: ToolContext, entry: CommandEntry): string {
  const raw = entry.cwd ?? ctx.allowlist.defaults?.cwd;
  if (!raw) {
    throw new LocalToolError("config_invalid", `no cwd configured for command '${entry.id}'`);
  }
  const cwd = path.resolve(expandEnvVars(raw, ctx.env));
  if (!existsSync(cwd)) {
    throw new LocalToolError(
      "config_invalid",
      `cwd for '${entry.id}' does not exist: ${cwd} (create it or fix config/command-allowlist.json)`,
    );
  }
  return cwd;
}

/** The canonical args object hashed for the approval token (contract 7.3). */
export function resolvedArgsFor(
  entry: CommandEntry,
  commandId: string,
  validated: ValidatedArgs,
  cwd: string,
): { commandId: string; args: Record<string, string>; cwd: string } {
  return { commandId, args: validated.values, cwd };
}

/** READ tool: builds the exact-action preview for the approval modal. */
export function describeCommand(
  ctx: ToolContext,
  args: { commandId?: unknown; args?: unknown },
): ToolResult {
  const entry = resolveCommandEntry(ctx, args.commandId);
  if (entry.elevate) {
    throw new LocalToolError("elevation_not_supported", "elevated commands are not supported");
  }
  const validated = validateCommandArgs(entry, args.args);
  const cwd = resolveCwdFor(ctx, entry);
  const timeoutMs = entry.timeoutMs ?? ctx.allowlist.defaults?.timeoutMs ?? 15000;
  const maxOutputBytes = entry.maxOutputBytes ?? ctx.allowlist.defaults?.maxOutputBytes ?? 65536;
  const argv = [...(entry.baseArgs ?? []), ...validated.argvValues];

  return {
    ok: true,
    tool: "shell_describe_command",
    commandId: entry.id,
    description: entry.description,
    purpose: entry.purpose,
    impact: entry.impact,
    reversible: entry.reversible ?? true,
    executable: entry.executable,
    cwd,
    argv,
    timeoutMs,
    maxOutputBytes,
    riskClass: "CONSEQUENTIAL",
    approvalRequired: true,
    note: "allowlist runner, not a sandbox — only these exact commands with these exact validated arguments can ever be approved",
  };
}
