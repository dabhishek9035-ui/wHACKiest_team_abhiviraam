# Pengu

> A persistent, customizable AI desktop companion that connects everyday applications through **MCP**, keeps unfinished work available across restarts and lets routine tasks flow while requiring user approval for consequential actions.

Team **Abhiviraam** · BMSITM · wHACKiest 2026 · Track 1 — *Make MCP Matter: Less Magic, More Utility*.

> **README ownership:** this file is owned by M1 (technical lead). M4 (project lead) drafted this working version so the repository is usable from a clean clone; M1 may restructure it at any time.

## Workstreams

| Workstream | Owner | Ownership |
|---|---|---|
| M1 | Ronit Kapar (`1BY25CS253`) | Agent runtime, MCP client/registry, policy/approval gate, contracts, root config |
| M2 | Suparna Darsi (`1BY25CS303`) | Tauri + React desktop app (pet, composer, workspace, approval modal, timeline) |
| M3 | Maneesha G (`1BY25CS170`) | Gmail MCP server, Sarvam STT/TTS voice services, email fixtures |
| M4 | D Venkata Abhishek (`1TD25CS079`) | Local MCP server, SQLite store/checkpoint/restore, e2e/security QA, integration owner |

M1–M4 are **workstream IDs**, not roster numbers. `packages/contracts` changes only via M1, announced to everyone; M4 validates and merges PRs.

## Repository layout

```
packages/contracts   [M1] frozen TypeScript contracts (events, tools, approval, store, voice)
packages/store       [M4] SQLite persistence: tasks, steps, checkpoints, approvals,
                          receipts, side effects + in-memory twin + restore/continuity
services/agent       [M1] Node sidecar: GLM runtime, policy gate, MCP client, WS server (M3 voice inside)
mcp/gmail            [M3] Gmail MCP stdio server (search/read/draft/send + token verification)
mcp/local            [M4] Local MCP stdio server: scoped fs, Chrome URLs, allowlisted apps,
                          restricted shell (ALLOWLIST RUNNER, NOT A SANDBOX)
apps/desktop         [M2] Tauri + React UI (pet, composer, workspace, approval modal)
fixtures/            [M3 emails / M4 web] normal + hostile content for A15 tests
scripts/             [M4] dev.ps1, restart-test.ps1, inject-test.ps1 + node harnesses
tests/e2e/           [M4] runnable acceptance procedures (A6–A15)
docs/                STRUCTURE/CONTRACTS/DECISIONS [M1] · INTEGRATION/DEMO_SCRIPT [M4]
```

## Run from a clean clone

Prerequisites: **Node 20+** (tested on 25), **pnpm 10+**, Windows 10/11 (PowerShell) for local actions, Chrome for URL opening.

```powershell
pnpm install
copy .env.example .env        # then fill values locally — NEVER commit them
pnpm build
pnpm test                     # 59 automated tests green
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/dev.ps1
```

Required env vars (names in `.env.example`): `SARVAM_API_KEY`, `PENGU_APPROVAL_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `PENGU_WS_TOKEN`, `PENGU_LOG_LEVEL`. Values are never logged and never committed.

**Current build state (honest):** `packages/store` and `mcp/local` are implemented and tested; `packages/contracts`, `services/agent`, `mcp/gmail` and `apps/desktop` are header-only scaffold placeholders owned by M1–M3. `scripts/dev.ps1` reports component readiness instead of pretending.

## Automated evidence (works today)

| Command | Proves |
|---|---|
| `pnpm --filter @pengu/store test` | 35 tests — store contract over SQLite **and** in-memory twins, atomic transactions, restore view + side-effect reconciliation (A12/A13/A14 halves) |
| `pnpm --filter @pengu/local-mcp test` | 24 tests — root scoping, traversal + junction-escape denial, unknown-command/invalid-args denial, missing/expired/wrong-secret/wrong-tool/edited-args approval tokens, real allowlisted run (A9/A11 halves) |
| `powershell -File scripts/restart-test.ps1` | forced kill mid-task → relaunch → task pending, side effect verified, **no duplicate folder/receipt** (A13/A14) |
| `powershell -File scripts/inject-test.ps1` | hostile web page: 7/7 attacks refused server-side, sandbox untouched (A15 web half) |

Full acceptance procedures A1–A15: `tests/e2e/*.md` · Demo walkthrough: `docs/DEMO_SCRIPT.md`.

## Security model (short version)

- **The model proposes; the policy gate decides.** Enforcement lives in the execution path; MCP servers verify approval tokens independently as a second line of defence.
- **Deny by default.** Unknown commands, bad args, out-of-scope paths, non-HTTP(S) URLs, non-allowlisted apps are refused — and refusals are not approvable.
- **Exact-action approvals.** HMAC token over `{approvalId, tool, argsHash, expiresAt}`; any material change invalidates it; tokens are injected server-side and never reach the model or UI; approvals never survive a restart.
- **Untrusted content is data.** Email/web content can never grant permissions, change recipients or start tasks.
- **The restricted shell is an allowlist runner, not a sandbox.** It prevents running anything outside the allowlist; it provides no OS-level isolation.

## License / attribution

Hackathon project — see `docs/` for architecture and contracts.
