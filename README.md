# Pengu

**Pengu** is a persistent, customizable AI desktop companion that connects everyday applications through **MCP** (Model Context Protocol), keeps unfinished work available across restarts, and lets routine tasks flow while requiring explicit user approval for consequential actions.

- **Event:** wHACKiest 2026 — Track 1: *Make MCP Matter - Less Magic, More Utility*
- **Team:** Abhiviraam (BMSITM)
- **Repository policy:** This canonical repository is submitted by **24 November 2026** and remains the single repository for all commits through the **26–27 November 2026** presentations.

## Team & Workstream Ownership

> `M1–M4` are workstream IDs, not roster numbering.

| Workstream | Owner | Role | Scope |
|---|---|---|---|
| **M1** | Ronit Kapar (`1BY25CS253`) | Technical Lead | Agent runtime, MCP client/registry, policy/approval gate, `@pengu/contracts`, root config |
| **M2** | Suparna Darsi (`1BY25CS303`) | Desktop UI Owner | Tauri + React floating pet, composer, workspace, avatar picker, approval modal, timeline, history, restore |
| **M3** | Maneesha G (`1BY25CS170`) | Gmail & Voice Owner | Gmail MCP stdio server, Sarvam STT/TTS voice services, email fixtures |
| **M4** | D Venkata Abhishek (`1TD25CS079`) | Project/Team Lead & Integration Owner | Local MCP stdio server, SQLite store/checkpoint/restore, E2E/security QA, PR merges, demo script |

## Architecture

```text
Tauri + React UI (M2) <--WebSocket 127.0.0.1:7777 (token auth)--> services/agent (M1)
                                                                    ├─ GLM Client (Sarvam /v2, glm5.3)
                                                                    ├─ Runtime Loop / Planner / Lifecycle / Resume
                                                                    ├─ Policy & Approval Gate (HMAC-SHA256)
                                                                    ├─ MCP Client & Registry
                                                                    ├─ Voice Routes (M3: Saaras STT / Bulbul TTS)
                                                                    └─ @pengu/store (M4: SQLite checkpoints/receipts)
                                    MCP stdio ──► mcp/gmail (M3)
                                    MCP stdio ──► mcp/local (M4)
```

## Quick Start (Clean Clone)

1. **Prerequisites:** Node.js 18+ (20+ recommended), `pnpm` 9+, Rust/Tauri toolchain (for desktop UI), Windows 10/11 (for PowerShell local tools).
2. **Install dependencies:**
   ```bash
   pnpm install
   ```
3. **Configure environment:** Copy `.env.example` to `.env` (never commit `.env`) and populate:
   - `SARVAM_API_KEY` — Sarvam Token Factory & Speech API key
   - `PENGU_APPROVAL_SECRET` — high-entropy local secret for HMAC-SHA256 approval tokens
   - `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — Google Desktop OAuth credentials
   - `PENGU_WS_TOKEN` — optional fixed dev token (if omitted, `services/agent` generates a per-launch random token)
   - `PENGU_LOG_LEVEL` — `debug` | `info` | `warn` | `error`
4. **Build & test M1 core:**
   ```bash
   pnpm --filter @pengu/contracts build
   pnpm --filter @pengu/agent build
   pnpm --filter @pengu/agent test
   ```
5. **Run GLM live smoke test (requires `SARVAM_API_KEY`):**
   ```bash
   pnpm --filter @pengu/agent smoke:glm
   ```
6. **Start full stack (Windows):**
   ```powershell
   .\scripts\dev.ps1
   ```

## Honest Claims & Scope Boundaries

- **Cloud vs. local processing:** GLM reasoning (`glm5.3`) and Sarvam speech (`saaras:v4` / `bulbul`) run via Sarvam cloud APIs. Task history, checkpoints, policy enforcement, and approval records are stored and enforced locally.
- **Allowlist runner, not an OS sandbox:** `shell_run_restricted` enforces an allowlist of command IDs, validated arguments, fixed working directory, timeout, output cap, and HMAC approval tokens. It is **not** an OS-level security sandbox.
- **No model chain-of-thought exposure:** Pengu displays observable task plans, step summaries, tool activity, approvals, and verified outcomes — never private model chain-of-thought (`reasoning_content`).
- **Duplicate-safe, not mathematically guaranteed exactly-once:** Side effects persist intent before execution and results afterward; on restart, indeterminate remote outcomes prompt the user rather than retrying blindly.

## Documentation

- [`docs/STRUCTURE.md`](docs/STRUCTURE.md) — Canonical repo layout, file ownership, and communication matrix
- [`docs/CONTRACTS.md`](docs/CONTRACTS.md) — Frozen WebSocket, tool manifest, approval token, store, voice, and resume contracts
- [`docs/DECISIONS.md`](docs/DECISIONS.md) — Architecture decisions and verified Sarvam API specifications
- [`docs/INTEGRATION.md`](docs/INTEGRATION.md) — Integration gates (G0–G5), Definition of Done, handshake tests, and sign-off workflow
- [`docs/DEMO_SCRIPT.md`](docs/DEMO_SCRIPT.md) — Presentation walkthrough and QA checklist (M4)
