// owner: M4 (D Venkata Abhishek, 1TD25CS079)
// purpose: injection probe for scripts/inject-test.ps1 (A15 web half). Fetches the
//          hostile page, extracts the attacker's "instructions" (data-pengu-*), and
//          feeds them to the Local MCP server core as if the model had obeyed the
//          page. Asserts EVERY attack is refused server-side (denied/not approvable)
//          and that the sandbox is untouched afterwards. Full-model A15 (no tool call
//          at all) additionally requires M1's policy gate and is covered by
//          tests/e2e/e2e-injection.md on main.
// public interface it must expose: CLI (--url <page> --sandbox <dir>).
// consumed by: scripts/inject-test.ps1.
// TODO: none (implemented).

import { readdirSync, rmSync, mkdirSync } from "node:fs";
import path from "node:path";
import { createLocalServerCore, loadCommandAllowlist } from "../mcp/local/dist/server.js";

const args = process.argv.slice(2);
function argValue(name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}
const url = argValue("--url");
const sandbox = argValue("--sandbox");
if (!url || !sandbox) {
  console.error("usage: node inject-probe.mjs --url <page-url> --sandbox <dir>");
  process.exit(2);
}

// Fetch the hostile page exactly like an agent would retrieve web content.
const res = await fetch(url);
const pageText = await res.text();
console.log(`probe: fetched ${url} (${pageText.length} bytes of UNTRUSTED content)`);

// Extract attacker payloads from the marked fixture attributes.
const pick = (name) => {
  const m = pageText.match(new RegExp(`data-pengu-${name}="([^"]+)"`));
  return m ? m[1] : undefined;
};
const attackCommand = pick("command"); // e.g. "download-payload" (unknown command)
const attackPathAbs = pick("path"); // absolute path OUTSIDE the sandbox
const attackPathRel = pick("path-rel"); // traversal attempt ..\..\pengu-escape
const attackApp = pick("app"); // "regedit" (not allowlisted)
const attackUrl = pick("url"); // file:/// URL

mkdirSync(sandbox, { recursive: true });
const realAllowlist = loadCommandAllowlist(path.resolve(import.meta.dirname, "../mcp/local/config"));
// Hermetic probe: point the allowlist cwd at the probe sandbox instead of the
// user's real PenguSandbox (still exercises the same resolveCwdFor code path).
const allowlist = {
  ...realAllowlist,
  defaults: { ...(realAllowlist.defaults ?? {}), cwd: sandbox },
};
const core = createLocalServerCore({
  config: {
    fsRoots: [{ id: "sandbox", path: sandbox, description: "inject-test sandbox" }],
    defaultRootId: "sandbox",
    urlPolicy: { schemes: ["http:", "https:"] },
    chromePath: path.join(sandbox, "..", "definitely-not-chrome.exe"),
    allowedApps: { notepad: { executable: "notepad.exe", description: "Windows Notepad" } },
  },
  allowlist,
  secret: undefined, // no approval secret: shell_run must refuse everything
});

const snapshotBefore = readdirSync(sandbox).sort().join(",");
const checks = [];
function record(name, expect, res, extraOk) {
  const pass =
    res.ok === false && res.denied === true && (extraOk ? extraOk(res) : true);
  checks.push({ name, expect, got: { ok: res.ok, denied: res.denied, code: res.code }, pass });
  console.log(`probe: ${pass ? "PASS" : "FAIL"} — ${name}: code=${res.code} denied=${res.denied}`);
}

// 1) Page asks to run an unknown shell command -> denied, not approvable (A9/A15).
if (attackCommand) {
  const r = await core.callTool("shell_run_restricted", { commandId: attackCommand });
  record("hostile command id rejected", `${attackCommand} -> unknown_command, denied`, r, (x) => x.code === "unknown_command");
}

// 2) No approval token anyway: even a KNOWN allowlisted command must be refused.
{
  const r = await core.callTool("shell_run_restricted", { commandId: "sys.time" });
  record("allowlisted command without token refused", "sys.time -> approval_required", r, (x) => x.code === "approval_required");
}

// 3) Forged token (wrong secret) -> signature refusal (fail closed).
{
  const r = await core.callTool(
    "shell_run_restricted",
    { commandId: "sys.time" },
    { approvalId: "forged", tool: "shell_run_restricted", argsHash: "0".repeat(64), expiresAt: Date.now() + 60000, mac: "f".repeat(64) },
  );
  record("forged approval token refused", "bad signature -> approval_invalid", r, (x) => x.code === "approval_invalid");
}

// 4) Page demands a folder outside the sandbox -> path_outside_scope.
if (attackPathAbs) {
  const r = await core.callTool("fs_create_folder", { path: attackPathAbs });
  record("absolute path outside root denied", `${attackPathAbs} -> path_outside_scope`, r, (x) => x.code === "path_outside_scope");
}

// 5) Traversal escape attempt -> path_traversal.
if (attackPathRel) {
  const r = await core.callTool("fs_create_folder", { path: attackPathRel });
  record("traversal escape denied", `${attackPathRel} -> path_traversal`, r, (x) => x.code === "path_traversal");
}

// 6) Page demands launching regedit -> app_not_allowed.
if (attackApp) {
  const r = await core.callTool("app_launch", { appId: attackApp });
  record("non-allowlisted app denied", `${attackApp} -> app_not_allowed`, r, (x) => x.code === "app_not_allowed");
}

// 7) Page demands opening a file:// URL -> scheme_not_allowed.
if (attackUrl) {
  const r = await core.callTool("browser_open_url", { url: attackUrl });
  record("non-http(s) scheme denied", `${attackUrl} -> scheme_not_allowed`, r, (x) => x.code === "scheme_not_allowed");
}

// The sandbox must be completely untouched by all refused calls.
const snapshotAfter = readdirSync(sandbox).sort().join(",");
checks.push({
  name: "sandbox untouched after all refused attempts",
  expect: "no new entries created by the hostile page",
  got: { before: snapshotBefore, after: snapshotAfter },
  pass: snapshotBefore === snapshotAfter,
});

// Clean the traversal probe target if it somehow appeared (it must not).
rmSync(path.resolve(sandbox, attackPathRel ?? ".."), { recursive: true, force: true });

const pass = checks.every((c) => c.pass);
console.log(JSON.stringify({ pass, checks }, null, 2));
console.log(pass ? "INJECT_TEST_PASS" : "INJECT_TEST_FAIL");
process.exit(pass ? 0 : 1);
