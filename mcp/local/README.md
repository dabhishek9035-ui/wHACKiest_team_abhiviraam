# @pengu/local-mcp

**Owner:** M4 — D Venkata Abhishek (`1TD25CS079`), project/team lead and integration owner.

**Purpose:** Pengu's Local MCP stdio server (contract 7.2): scoped filesystem tools, Chrome URL opening, allowlisted app launch and the restricted shell runner — the second line of defence that independently verifies every consequential action.

> **This is an allowlist runner, NOT a sandbox.** It prevents the agent from running anything outside the explicit allowlist and granted scopes. It does not contain a determined attacker and provides no OS-level isolation. We state this plainly everywhere (honest-claims rule).

## Tools (contract 7.2)

| Tool | Risk class | Side effect | Idempotent | Verifiable on resume | Approval token |
|---|---|---|---|---|---|
| `fs_list_dir` | READ | no | yes | n/a | no |
| `fs_create_folder` | ROUTINE (inside approved roots only) | yes | yes (exists => `alreadyExisted:true`) | **local** (folder exists) | no |
| `browser_open_url` | ROUTINE (http/https only) | yes | no | **unknown** | no |
| `app_launch` | ROUTINE (allowlisted app IDs only) | yes | no | **unknown** | no |
| `shell_describe_command` | READ | no | yes | n/a | no |
| `shell_run_restricted` | **CONSEQUENTIAL** | yes | no | receipt | **yes** (previewTool `shell_describe_command`) |

## Security model (A9/A11/A15 server halves)

- **Deny by default.** Unknown tool names, unknown command IDs, invalid args, paths outside granted roots, non-HTTP(S) schemes, non-allowlisted apps: all refused, and refusals are *not approvable* — no user approval can make them run.
- **`..` traversal and symlink escapes are rejected.** Paths are resolved to real paths (`realpathSync.native`); a path that looks inside a root but resolves outside via a symlink/junction fails with `symlink_escape`.
- **Exact-action approval (A9).** `shell_run_restricted` recomputes `argsHash = sha256(canonicalJSON({commandId, args, cwd}))` from the *actual* resolved action and verifies `HMAC-SHA256(PENGU_APPROVAL_SECRET, canonicalJSON({approvalId, tool, argsHash, expiresAt}))` plus expiry. Any mismatch — wrong secret, expired, wrong tool, edited args — is refused.
- **The token is injected by M1** into the server-side MCP invocation as the reserved request `_meta.penguApproval` field. It is never a model-visible tool argument and never reaches the desktop UI.
- **Hard limits.** Fixed cwd from config, no shell (`spawn` with `shell:false`), timeout kill, per-stream output cap, minimal child environment (no secrets passed down), no elevation (`elevate:true` entries are refused).
- **No free-form commands.** Only `commandId`s from `config/command-allowlist.json` with per-arg regex-validated values templated into single argv elements. Unknown/bad => denied.
- **Config is the only source of paths.** No hardcoded paths in code (`config/local-scopes.json`, `config/command-allowlist.json`). `%VAR%` expansion fails closed on unknown variables.

## Files

| File | What it is |
|---|---|
| `src/server.ts` | config loading, transport-independent server core (`callTool`), MCP stdio wiring, entrypoint |
| `src/verify-token.ts` | canonicalJSON / argsHash / HMAC sign+verify (contract 7.3) |
| `src/types.ts` | error codes, config shapes, `ToolContext`, `ApprovalMeta` |
| `src/tools/create-folder.ts` | scoped, idempotent folder creation |
| `src/tools/list-dir.ts` | scoped directory listing (names/types only, capped) |
| `src/tools/open-url.ts` | http/https-only URL opening in Chrome |
| `src/tools/launch-app.ts` | allowlisted app launch |
| `src/tools/shell-describe.ts` | allowlist resolution, arg validation, approval preview |
| `src/tools/shell-run.ts` | token-verified restricted execution |
| `src/platform/windows.ts` | all Windows specifics (env expansion, realpaths, containment, Chrome discovery, spawn caps) |
| `config/local-scopes.json` | granted fs roots, URL policy, allowed apps (setup permission) |
| `config/command-allowlist.json` | allowlisted command IDs (read-only/info commands) |
| `tool-manifest.json` | the manifest M1's policy gate reads (contract 7.2) |
| `test/local-server.test.ts` | 24 policy tests (scoping, traversal, junction escape, unknown command, bad args, missing/expired/wrong-secret/wrong-tool/edited-args tokens, real allowlisted run) |

## Running

```powershell
# from the repo root
pnpm install ; pnpm --filter @pengu/local-mcp build
# stdio server (normally spawned by the agent; for manual inspection:)
$env:PENGU_APPROVAL_SECRET = "<dev secret>"   # never committed
node mcp/local/dist/server.js                # logs go to stderr; stdout is MCP protocol
```

`PENGU_LOCAL_MCP_CONFIG` overrides the config directory. Without `PENGU_APPROVAL_SECRET`, `shell_run_restricted` always refuses (fail closed).

## How it is "done" (Definition of Done)

- [x] All six manifest tools implemented; manifest matches contract 7.2 exactly.
- [x] A11: folder creation inside an approved root needs no per-task approval; outside => denied.
- [x] A9 (server half): no token / expired / wrong secret / wrong tool / edited args => refused; unknown command or bad args => denied, not approvable.
- [x] Traversal + junction-escape tests green; unknown-command and token tests green.
- [x] Honest result envelope: `verifiable:false` + unknown-on-resume for URL/app launches.
- [x] No secrets in code, logs or results; child processes get a minimal environment.

Advances acceptance IDs: **A9 (server half), A10, A11, A15 (web half)**. Evidence: `pnpm --filter @pengu/local-mcp test`.
