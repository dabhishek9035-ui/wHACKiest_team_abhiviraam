// owner: M4 (D Venkata Abhishek, 1TD25CS079)
// purpose: policy-adjacent tests for the Local MCP server core (A9/A10/A11/A15 server
//          halves): root scoping, `..` traversal, symlink/junction escape, unknown
//          command denial, invalid args denial, and missing/expired/wrong-tool/
//          mismatched/valid approval-token handling for shell_run_restricted.
// public interface it must expose: none (tests).
// consumed by: `pnpm --filter @pengu/local-mcp test`.
// TODO: none (implemented).

import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createLocalServerCore, type LocalServerCore } from "../src/server.js";
import { argsHashOf, signApprovalToken } from "../src/verify-token.js";
import type { CommandAllowlist, LocalConfig } from "../src/types.js";

let tmpRoot: string;
let sandbox: string;
let core: LocalServerCore;
let secret: string;
let now: number;

function makeConfig(sandboxPath: string, tmpPath: string): LocalConfig {
  return {
    fsRoots: [
      { id: "sandbox", path: sandboxPath, description: "test sandbox" },
    ],
    defaultRootId: "sandbox",
    urlPolicy: { schemes: ["http:", "https:"], allowCredentials: false, blockedHosts: ["evil.example"] },
    // Explicit but missing: findChrome must fail closed (no real browser in unit tests).
    chromePath: path.join(tmpPath, "definitely-not-chrome.exe"),
    allowedApps: {
      dummy: { executable: "cmd.exe", args: ["/c", "exit"], description: "harmless instant-exit app" },
    },
  };
}

function makeAllowlist(): CommandAllowlist {
  return {
    defaults: { timeoutMs: 15000, maxOutputBytes: 65536, cwd: sandbox },
    commands: [
      {
        id: "sys.echo",
        description: "Echo a fixed string (no arguments)",
        purpose: "Test-only read-only command",
        impact: "None — prints a fixed string",
        reversible: true,
        executable: "powershell.exe",
        baseArgs: ["-NoProfile", "-NonInteractive", "-Command", "Write-Output allowlist-ok"],
        args: [],
      },
      {
        id: "sys.process_info",
        description: "Filter tasklist by image name",
        purpose: "Test-only read-only command with a validated argument",
        impact: "None — read-only process query",
        reversible: true,
        executable: "tasklist.exe",
        baseArgs: ["/FI"],
        args: [
          {
            name: "imageName",
            required: true,
            pattern: "^[A-Za-z0-9._ -]{1,64}$",
            template: "IMAGENAME eq {value}",
          },
        ],
      },
    ],
  };
}

/** Builds the exact resolvedArgs the gate would hash for a run (contract 7.3). */
function resolvedArgs(commandId: string, args: Record<string, string>, cwd: string) {
  return { commandId, args, cwd };
}

beforeEach(() => {
  tmpRoot = mkdtempSync(path.join(tmpdir(), "pengu-local-test-"));
  sandbox = path.join(tmpRoot, "sandbox");
  mkdirSync(sandbox, { recursive: true });
  writeFileSync(path.join(sandbox, "dummy-app.txt"), "not an executable");
  secret = "unit-test-approval-secret";
  now = Date.now();
  core = createLocalServerCore({
    config: makeConfig(sandbox, tmpRoot),
    allowlist: makeAllowlist(),
    secret,
    nowMs: () => now,
  });
});

afterEach(() => {
  try {
    rmSync(tmpRoot, { recursive: true, force: true });
  } catch {
    // best-effort cleanup on Windows file locks
  }
});

describe("fs_create_folder scoping (A11)", () => {
  it("creates a folder inside the approved root without approval", async () => {
    const res = await core.callTool("fs_create_folder", { path: "reports" });
    expect(res.ok).toBe(true);
    expect(res.alreadyExisted).toBe(false);
    expect(existsSync(path.join(sandbox, "reports"))).toBe(true);
  });

  it("is idempotent: existing folder returns alreadyExisted:true", async () => {
    await core.callTool("fs_create_folder", { path: "reports" });
    const res = await core.callTool("fs_create_folder", { path: "reports" });
    expect(res.ok).toBe(true);
    expect(res.alreadyExisted).toBe(true);
  });

  it("denies absolute paths outside the approved root", async () => {
    const res = await core.callTool("fs_create_folder", { path: path.join(tmpRoot, "outside") });
    expect(res.ok).toBe(false);
    expect(res.code).toBe("path_outside_scope");
    expect(existsSync(path.join(tmpRoot, "outside"))).toBe(false);
  });

  it("rejects `..` traversal even when it would only escape one level", async () => {
    // Deliberately keep the literal '..' in the string (path.join would normalize it away).
    const res = await core.callTool("fs_create_folder", {
      path: sandbox + path.sep + ".." + path.sep + "escape",
    });
    expect(res.ok).toBe(false);
    expect(res.code).toBe("path_traversal");
    expect(existsSync(path.join(tmpRoot, "escape"))).toBe(false);
  });

  it("rejects symlink/junction escapes pointing outside the root", async () => {
    const outside = path.join(tmpRoot, "outside-target");
    mkdirSync(outside, { recursive: true });
    const link = path.join(sandbox, "freedom");
    symlinkSync(outside, link, "junction");
    const res = await core.callTool("fs_create_folder", { path: path.join(link, "pwned") });
    expect(res.ok).toBe(false);
    expect(res.code).toBe("symlink_escape");
    expect(existsSync(path.join(outside, "pwned"))).toBe(false);
  });
});

describe("fs_list_dir scoping", () => {
  it("lists entries with types and honours the limit cap", async () => {
    for (const n of ["a", "b", "c"]) {
      mkdirSync(path.join(sandbox, n), { recursive: true });
    }
    writeFileSync(path.join(sandbox, "f.txt"), "x");
    // sandbox already contains dummy-app.txt from beforeEach -> 5 entries total
    const res = await core.callTool("fs_list_dir", { path: ".", limit: 2 });
    expect(res.ok).toBe(true);
    expect(res.truncated).toBe(true);
    expect(res.count).toBe(2);
    const all = await core.callTool("fs_list_dir", { path: "." });
    expect(all.count).toBe(5);
    expect(all.entries).toContainEqual({ name: "a", type: "dir" });
    expect(all.entries).toContainEqual({ name: "f.txt", type: "file" });
  });

  it("denies listing outside the root", async () => {
    const res = await core.callTool("fs_list_dir", { path: tmpRoot });
    expect(res.ok).toBe(false);
    expect(res.denied).toBe(true);
  });
});

describe("browser_open_url policy", () => {
  it("refuses non-http(s) schemes", async () => {
    for (const url of ["file:///C:/Windows/notepad.exe", "javascript:alert(1)", "ftp://example.com"]) {
      const res = await core.callTool("browser_open_url", { url });
      expect(res.ok).toBe(false);
      expect(res.code).toBe("scheme_not_allowed");
    }
  });

  it("refuses URLs with embedded credentials and blocked hosts", async () => {
    const creds = await core.callTool("browser_open_url", { url: "http://user:pass@example.com/" });
    expect(creds.code).toBe("url_credentials_not_allowed");
    const blocked = await core.callTool("browser_open_url", { url: "https://evil.example/page" });
    expect(blocked.code).toBe("host_blocked");
  });

  it("fails closed when Chrome is not configured/found instead of opening the default browser", async () => {
    const res = await core.callTool("browser_open_url", { url: "https://example.com/doc" });
    // no real Chrome in the unit-test environment => explicit refusal, no side effect
    expect(res.ok).toBe(false);
    expect(res.code).toBe("chrome_not_found");
  });
});

describe("app_launch policy", () => {
  it("denies unknown app IDs", async () => {
    const res = await core.callTool("app_launch", { appId: "regedit" });
    expect(res.ok).toBe(false);
    expect(res.code).toBe("app_not_allowed");
  });

  it("accepts an allowlisted app ID (launch itself is fire-and-forget, verifiable:false)", async () => {
    const res = await core.callTool("app_launch", { appId: "dummy" });
    expect(res.ok).toBe(true);
    expect(res.verifiable).toBe(false);
  });
});

describe("shell_describe_command / shell_run_restricted policy (A9)", () => {
  it("denies unknown command IDs as not approvable", async () => {
    const d = await core.callTool("shell_describe_command", { commandId: "download-payload" });
    expect(d.ok).toBe(false);
    expect(d.code).toBe("unknown_command");
    expect(d.denied).toBe(true);

    const r = await core.callTool("shell_run_restricted", { commandId: "download-payload" });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("unknown_command");
    expect(r.denied).toBe(true);
  });

  it("denies invalid args (missing required, pattern violation, unknown arg)", async () => {
    const missing = await core.callTool("shell_describe_command", { commandId: "sys.process_info" });
    expect(missing.code).toBe("invalid_args");

    const pattern = await core.callTool("shell_run_restricted", {
      commandId: "sys.process_info",
      args: { imageName: "evil; rm -rf" },
    });
    expect(pattern.code).toBe("invalid_args");
    expect(pattern.denied).toBe(true);

    const unknown = await core.callTool("shell_run_restricted", {
      commandId: "sys.process_info",
      args: { imageName: "notepad.exe", extra: "nope" },
    });
    expect(unknown.code).toBe("invalid_args");
  });

  it("returns the exact-action preview for a valid command", async () => {
    const res = await core.callTool("shell_describe_command", {
      commandId: "sys.process_info",
      args: { imageName: "notepad.exe" },
    });
    expect(res.ok).toBe(true);
    expect(res.riskClass).toBe("CONSEQUENTIAL");
    expect(res.cwd).toBe(sandbox);
    expect(res.argv).toEqual(["/FI", "IMAGENAME eq notepad.exe"]);
    expect(res.approvalRequired).toBe(true);
  });

  it("refuses to run without an approval token", async () => {
    const res = await core.callTool("shell_run_restricted", { commandId: "sys.echo" });
    expect(res.ok).toBe(false);
    expect(res.code).toBe("approval_required");
  });

  it("refuses a token signed with the wrong secret", async () => {
    const hash = argsHashOf(resolvedArgs("sys.echo", {}, sandbox));
    const forged = signApprovalToken({
      secret: "attacker-secret",
      approvalId: "a1",
      tool: "shell_run_restricted",
      argsHash: hash,
      expiresAt: now + 60_000,
    });
    const res = await core.callTool("shell_run_restricted", { commandId: "sys.echo" }, forged);
    expect(res.ok).toBe(false);
    expect(res.code).toBe("approval_invalid");
  });

  it("refuses an expired token", async () => {
    const hash = argsHashOf(resolvedArgs("sys.echo", {}, sandbox));
    const token = signApprovalToken({
      secret,
      approvalId: "a2",
      tool: "shell_run_restricted",
      argsHash: hash,
      expiresAt: now - 1,
    });
    const res = await core.callTool("shell_run_restricted", { commandId: "sys.echo" }, token);
    expect(res.ok).toBe(false);
    expect(res.code).toBe("approval_invalid");
  });

  it("refuses a token bound to a different tool", async () => {
    const hash = argsHashOf(resolvedArgs("sys.echo", {}, sandbox));
    const token = signApprovalToken({
      secret,
      approvalId: "a3",
      tool: "gmail_send_draft",
      argsHash: hash,
      expiresAt: now + 60_000,
    });
    const res = await core.callTool("shell_run_restricted", { commandId: "sys.echo" }, token);
    expect(res.ok).toBe(false);
  });

  it("refuses when args changed after approval (hash mismatch)", async () => {
    // Token approved for imageName=notepad.exe; request now carries cmd.exe.
    const approvedHash = argsHashOf(
      resolvedArgs("sys.process_info", { imageName: "notepad.exe" }, sandbox),
    );
    const token = signApprovalToken({
      secret,
      approvalId: "a4",
      tool: "shell_run_restricted",
      argsHash: approvedHash,
      expiresAt: now + 60_000,
    });
    const res = await core.callTool(
      "shell_run_restricted",
      { commandId: "sys.process_info", args: { imageName: "cmd.exe" } },
      token,
    );
    expect(res.ok).toBe(false);
    expect(res.code).toBe("approval_invalid");
  });

  it("runs an allowlisted command with a valid, unexpired exact-action token", async () => {
    const hash = argsHashOf(resolvedArgs("sys.echo", {}, sandbox));
    const token = signApprovalToken({
      secret,
      approvalId: "a5",
      tool: "shell_run_restricted",
      argsHash: hash,
      expiresAt: now + 60_000,
    });
    const res = await core.callTool("shell_run_restricted", { commandId: "sys.echo" }, token);
    expect(res.ok).toBe(true);
    expect(res.exitCode).toBe(0);
    expect(String(res.stdoutHead)).toContain("allowlist-ok");
    expect(res.approvalId).toBe("a5");
  }, 30000);

  it("runs with a validated argument when the token covers exactly those args", async () => {
    const hash = argsHashOf(
      resolvedArgs("sys.process_info", { imageName: "notepad.exe" }, sandbox),
    );
    const token = signApprovalToken({
      secret,
      approvalId: "a6",
      tool: "shell_run_restricted",
      argsHash: hash,
      expiresAt: now + 60_000,
    });
    const res = await core.callTool(
      "shell_run_restricted",
      { commandId: "sys.process_info", args: { imageName: "notepad.exe" } },
      token,
    );
    expect(res.ok).toBe(true);
    expect(res.exitCode).toBe(0);
  }, 30000);
});

describe("server core", () => {
  it("denies unknown tool names (fail closed)", async () => {
    const res = await core.callTool("format_c_drive", {});
    expect(res.ok).toBe(false);
    expect(res.code).toBe("unknown_tool");
  });

  it("serves the tool manifest with contract 7.2 risk classes", () => {
    const manifest = core.manifest() as {
      tools: Array<{ name: string; riskClass: string; requiresApprovalToken: boolean; previewTool?: string }>;
    };
    const byName = Object.fromEntries(manifest.tools.map((t) => [t.name, t]));
    expect(byName.fs_list_dir?.riskClass).toBe("READ");
    expect(byName.fs_create_folder?.riskClass).toBe("ROUTINE");
    expect(byName.browser_open_url?.riskClass).toBe("ROUTINE");
    expect(byName.app_launch?.riskClass).toBe("ROUTINE");
    expect(byName.shell_describe_command?.riskClass).toBe("READ");
    expect(byName.shell_run_restricted?.riskClass).toBe("CONSEQUENTIAL");
    expect(byName.shell_run_restricted?.requiresApprovalToken).toBe(true);
    expect(byName.shell_run_restricted?.previewTool).toBe("shell_describe_command");
  });
});
