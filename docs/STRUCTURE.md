# Pengu Repository Structure & Ownership (`docs/STRUCTURE.md`)

- **Owner:** M1 — Ronit Kapar (`1BY25CS253`), Technical Lead
- **Project/Team Lead & Integration Owner:** M4 — D Venkata Abhishek (`1TD25CS079`)
- **Rule:** Only the listed owner edits files inside their folders. Changes to `packages/contracts/**` or `docs/CONTRACTS.md` go through **M1** and must be announced to all workstreams; **M4** validates and merges PRs into `main`.

## 1. Workstream Ownership Summary

| Workstream | Owner | Owned Folders & Files | Must Not Touch | Ask For Changes |
|---|---|---|---|---|
| **M1** | Ronit Kapar (`1BY25CS253`) | Root config (`README.md`, `.gitignore`, `.env.example`, `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`), `docs/{STRUCTURE,CONTRACTS,DECISIONS}.md`, `packages/contracts/**`, `services/agent/**` (except `src/voice/**`) | `apps/desktop/**`, `mcp/gmail/**`, `services/agent/src/voice/**`, `mcp/local/**`, `packages/store/**`, `fixtures/**`, `scripts/**` | M2 (UI), M3 (Gmail/Voice), M4 (Local/Store/Integration) |
| **M2** | Suparna Darsi (`1BY25CS303`) | `apps/desktop/**` | `packages/contracts/**`, `services/agent/**`, `packages/store/**`, `mcp/**` | M1 (WS events / preview schema), M4 (integration merges) |
| **M3** | Maneesha G (`1BY25CS170`) | `mcp/gmail/**`, `services/agent/src/voice/**`, `fixtures/emails/**` | `packages/contracts/**`, `services/agent/src/{server,llm,runtime,mcp,policy}/**`, `apps/desktop/**`, `mcp/local/**`, `packages/store/**` | M1 (contracts / WS mounting / token format), M4 (E2E/merges) |
| **M4** | D Venkata Abhishek (`1TD25CS079`) | `packages/store/**`, `mcp/local/**`, `fixtures/web/**`, `scripts/**`, `tests/e2e/**`, `docs/DEMO_SCRIPT.md`, `docs/INTEGRATION.md` | `packages/contracts/**` (propose via M1), `services/agent/**`, `apps/desktop/**`, `mcp/gmail/**` | M1 (contracts/runtime), M2 (UI), M3 (Gmail/Voice) |

## 2. Who Talks To Whom (Runtime & Contract Boundaries)

| Caller | Target | Transport / Interface | Notes |
|---|---|---|---|
| Desktop UI (M2) | Agent Sidecar (M1) | Local WebSocket (`ws://127.0.0.1:7777`) with per-launch auth token | JSON events in `packages/contracts/src/events.ts`. UI never touches MCP, SQLite, Gmail, Sarvam, or approval tokens. |
| Agent Sidecar (M1) | Sarvam Token Factory | HTTPS `POST /v2/chat/completions` (`glm5.3`) | Server-side only; `SARVAM_API_KEY` from env; `reasoning_content` never sent to UI. |
| Agent Sidecar (M1) | Voice Routes (M3) | In-process `VoiceService` (`services/agent/src/voice/routes.ts`) | Mounted by `server/ws.ts` for `voice.audio` and `tts.request`. |
| Agent Sidecar (M1) | SQLite Store (M4) | In-process `StoreApi` (`@pengu/store`) | Called for every task, step, checkpoint, approval audit, receipt, and side effect. |
| Agent Sidecar (M1) | Gmail MCP (M3) | MCP over stdio (`mcp/gmail`) | Spawns server, reads `tool-manifest.json`, injects reserved approval token server-side on `gmail_send_draft`. |
| Agent Sidecar (M1) | Local MCP (M4) | MCP over stdio (`mcp/local`) | Spawns server, reads `tool-manifest.json`, injects reserved approval token server-side on `shell_run_restricted`. |

## 3. Complete File Inventory

### Root & Shared Docs

- `README.md` [M1] — Monorepo overview, setup steps, honest claims, and doc links.
- `.gitignore` [M1] — Ignores `node_modules`, build artifacts, SQLite files, logs, and `.env`/secret files.
- `.env.example` [M1] — Required environment variable names only (`SARVAM_API_KEY`, `PENGU_APPROVAL_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `PENGU_WS_TOKEN`, `PENGU_LOG_LEVEL`).
- `package.json` [M1] — Root workspace scripts and shared TypeScript devDependencies.
- `pnpm-workspace.yaml` [M1] — Declares `packages/*`, `services/*`, `mcp/*`, `apps/*`.
- `tsconfig.base.json` [M1] — Strict shared TypeScript compiler configuration.
- `docs/STRUCTURE.md` [M1] — File ownership, boundaries, and communication matrix.
- `docs/CONTRACTS.md` [M1] — Prose specification of frozen Section 7 contracts.
- `docs/DECISIONS.md` [M1] — Stack decisions, verified Sarvam API specs, and smoke-test record.
- `docs/INTEGRATION.md` [M4 owns, all contribute] — Dependency graph, DoD, handshake tests, G0–G5 gates, merge rules, demo flow.
- `docs/DEMO_SCRIPT.md` [M4] — Timed presentation script, failure-case demo, backup recording plan.

### `packages/contracts/` [M1]

- `packages/contracts/README.md` — Package purpose, owner, and freeze rules.
- `packages/contracts/src/index.ts` — Barrel export for all frozen contract types and constants.
- `packages/contracts/src/events.ts` — Exports `ClientMessage`, `ServerEvent`, `TaskSummaryItem`, `PetState`, `StepStatus`, `TaskTerminalStatus`; consumed by M1 WS server and M2 UI.
- `packages/contracts/src/tools.ts` — Exports `RiskClass`, `ToolManifest`, `ToolManifestEntry`, `UntrustedToolResult`, canonical tool names; consumed by M1, M3, M4.
- `packages/contracts/src/approval.ts` — Exports `ApprovalPreview`, `ApprovalTokenPayload`, `SignedApprovalToken`, `RESERVED_APPROVAL_TOKEN_FIELD`; consumed by M1, M2, M3, M4.
- `packages/contracts/src/store-api.ts` — Exports `StoreApi` and all persistence record shapes; implemented by M4, consumed by M1.
- `packages/contracts/src/voice-api.ts` — Exports `VoiceService`, `TranscribeInput/Output`, `SynthesizeInput/Output`, language table types; implemented by M3, consumed by M1.

### `services/agent/` [M1, except `src/voice/` M3]

- `services/agent/README.md` — Agent sidecar overview, env vars, and DoD verification commands.
- `services/agent/src/main.ts` — Sidecar bootstrap wiring store, MCP registry, policy gate, GLM client, runtime loop, voice routes, and WS server.
- `services/agent/src/server/ws.ts` — Authenticated `127.0.0.1:7777` WebSocket server implementing Section 7.1 events and mounting M3 voice routes.
- `services/agent/src/server/auth.ts` — Per-launch WebSocket auth token loader/generator and constant-time validator.
- `services/agent/src/llm/glm-client.ts` — Sarvam `/v2/chat/completions` client locked to `glm5.3` with native tool calling, strict-JSON fallback, and test-only replay mode.
- `services/agent/src/llm/prompts.ts` — System and turn prompt builders isolating trusted user intent from untrusted external tool content.
- `services/agent/src/runtime/loop.ts` — Core execution loop coordinating plan -> policy gate -> approval pause/resume -> MCP call -> receipt -> checkpoint.
- `services/agent/src/runtime/planner.ts` — Converts GLM proposals into observable steps and safe UI summaries (never exposes `reasoning_content`).
- `services/agent/src/runtime/lifecycle.ts` — Task state machine, honest terminal status resolution, and `pet.state` mapping.
- `services/agent/src/runtime/resume.ts` — Section 7.6 restart-safe resume orchestrator using M4 store and M3/M4 side-effect verifiers.
- `services/agent/src/mcp/client.ts` — MCP stdio JSON-RPC client spawning child servers and injecting reserved server-side approval tokens.
- `services/agent/src/mcp/registry.ts` — Loads `servers.config.json` and each server's `tool-manifest.json`, validates schemas, denies unknown tools.
- `services/agent/src/mcp/servers.config.json` — Stdio launch configuration for `gmail` and `local` MCP servers.
- `services/agent/src/policy/classify.ts` — Fail-closed manifest risk classifier (`READ` / `ROUTINE` / `CONSEQUENTIAL` / `DENY`).
- `services/agent/src/policy/scope.ts` — Checks granted Gmail scope, approved filesystem roots, HTTP(S) URLs, and allowlisted app/command IDs.
- `services/agent/src/policy/hard-deny.ts` — Blocks unknown/unsafe shell commands, path traversal, non-HTTP(S) schemes, and untrusted-originated commands (never approvable).
- `services/agent/src/policy/approval-gate.ts` — Coordinates policy checks, `previewTool` invocation, canonical `argsHash`, approval pause, expiry, invalidation, and HMAC minting.
- `services/agent/src/policy/token.ts` — Deterministic `canonicalJSON`, SHA-256 `argsHash`/`contentHash`, and HMAC-SHA256 sign/verify.
- `services/agent/src/policy/policy.rules.json` — Declarative risk, expiry, and hard-deny rule configuration.
- `services/agent/src/voice/stt.ts` [M3] — Sarvam Saaras v4 STT client.
- `services/agent/src/voice/tts.ts` [M3] — Sarvam Bulbul TTS client returning audio or `{unsupported:true, reason}`.
- `services/agent/src/voice/languages.ts` [M3] — Verified STT and TTS language capability tables.
- `services/agent/src/voice/routes.ts` [M3] — Exports `VoiceService` mounted by M1's `server/ws.ts`.
- `services/agent/test/policy.test.ts` [M1] — Policy gate, hard-deny, HMAC token, expiry, and draft-edit invalidation tests (T-03, T-04, T-05).
- `services/agent/test/runtime.test.ts` [M1] — Runtime loop, MCP registry, hostile-content isolation (T-08), and restart/resume deduplication tests (T-06, T-07).

### `packages/store/` [M4]

- `packages/store/README.md` — Store overview and SQLite transaction guarantees.
- `packages/store/src/index.ts` — Exports SQLite `StoreApi` and early in-memory stub.
- `packages/store/src/schema.sql` — SQLite DDL for tasks, steps, checkpoints, approvals, receipts, side_effects.
- `packages/store/src/tasks.ts` — Task CRUD and status transition queries.
- `packages/store/src/steps.ts` — Step append/update queries.
- `packages/store/src/checkpoints.ts` — Atomic checkpoint save/load.
- `packages/store/src/approvals.ts` — Approval audit trail persistence.
- `packages/store/src/receipts.ts` — Verified execution receipt storage.
- `packages/store/src/sideeffects.ts` — `beginSideEffect`, `completeSideEffect`, `getSideEffect`.
- `packages/store/src/restore.ts` — Pending-task restore summary builder (no secrets/private bodies).
- `packages/store/test/store.test.ts` — Store unit tests.
- `packages/store/test/restore.test.ts` — Restart/restore unit tests.

### `mcp/gmail/` [M3]

- `mcp/gmail/README.md` — Gmail MCP server setup, OAuth scopes, and stub mode docs.
- `mcp/gmail/tool-manifest.json` — Risk class, scope, and previewTool declarations for all 5 Gmail tools.
- `mcp/gmail/src/server.ts` — MCP stdio entrypoint and `PENGU_GMAIL_STUB=1` support.
- `mcp/gmail/src/auth.ts` — Desktop OAuth flow and secure external token storage.
- `mcp/gmail/src/untrusted.ts` — Wraps external email bodies/attachments as `{untrusted:true, content}`.
- `mcp/gmail/src/verify-token.ts` — Server-side HMAC-SHA256 verification against live draft `contentHash`.
- `mcp/gmail/src/tools/search.ts` — `gmail_search_threads` (READ).
- `mcp/gmail/src/tools/read-thread.ts` — `gmail_read_thread` (READ, untrusted-wrapped).
- `mcp/gmail/src/tools/create-draft.ts` — `gmail_create_draft` (ROUTINE).
- `mcp/gmail/src/tools/get-draft.ts` — `gmail_get_draft` (READ, returns `contentHash`).
- `mcp/gmail/src/tools/send-draft.ts` — `gmail_send_draft` (CONSEQUENTIAL, duplicate-safe) + sent verifier.

### `mcp/local/` [M4]

- `mcp/local/README.md` — Local MCP server docs explicitly stating allowlist runner is not an OS sandbox.
- `mcp/local/tool-manifest.json` — Manifest for all 6 local tools.
- `mcp/local/config/local-scopes.json` — Approved filesystem roots and allowlisted app IDs.
- `mcp/local/config/command-allowlist.json` — Allowlisted PowerShell command IDs, argument schemas, cwd, timeout, and output cap.
- `mcp/local/src/server.ts` — MCP stdio entrypoint.
- `mcp/local/src/verify-token.ts` — Server-side HMAC-SHA256 verifier for `shell_run_restricted`.
- `mcp/local/src/tools/create-folder.ts` — `fs_create_folder` (ROUTINE, idempotent, traversal/symlink-safe).
- `mcp/local/src/tools/list-dir.ts` — `fs_list_dir` (READ, scoped).
- `mcp/local/src/tools/open-url.ts` — `browser_open_url` (ROUTINE, http/https only).
- `mcp/local/src/tools/launch-app.ts` — `app_launch` (ROUTINE, allowlisted app IDs).
- `mcp/local/src/tools/shell-describe.ts` — `shell_describe_command` (READ preview tool).
- `mcp/local/src/tools/shell-run.ts` — `shell_run_restricted` (CONSEQUENTIAL, allowlist + HMAC verified).
- `mcp/local/src/platform/windows.ts` — Windows 10/11 process/Chrome/PowerShell adapter.

### `apps/desktop/` [M2]

- `apps/desktop/README.md` — Tauri + React UI setup and mock/live verification instructions.
- `apps/desktop/src-tauri/tauri.conf.json` — Frameless transparent always-on-top window config.
- `apps/desktop/src-tauri/src/main.rs` — Rust commands for window control, avatar persistence, and WS token retrieval.
- `apps/desktop/src/main.tsx` — React entrypoint.
- `apps/desktop/src/windows/PetWindow.tsx` — Floating draggable pet with tap/double-tap detection.
- `apps/desktop/src/windows/Composer.tsx` — Compact quick composer above pet.
- `apps/desktop/src/windows/Workspace.tsx` — Full tabbed workspace (Chat, Activity, History, Pending).
- `apps/desktop/src/components/ChatPanel.tsx` — Conversation panel + TTS playback/unsupported notices.
- `apps/desktop/src/components/ActivityTimeline.tsx` — Live step timeline with redaction-by-default.
- `apps/desktop/src/components/HistoryList.tsx` — Past tasks and honest outcomes.
- `apps/desktop/src/components/PendingTasks.tsx` — Startup restore view with Continue/Cancel/Leave.
- `apps/desktop/src/components/ApprovalModal.tsx` — Exact-action preview modal; disables expired/invalidated approvals.
- `apps/desktop/src/components/AvatarPicker.tsx` — Choose PNG/JPG/WebP, preview, apply, persist, reset.
- `apps/desktop/src/components/MicButton.tsx` — Audio capture -> `voice.audio`, renders transcript/TTS.
- `apps/desktop/src/components/StatusBadge.tsx` — Distinct honest badges for all terminal/active states.
- `apps/desktop/src/state/wsClient.ts` — Authenticated WS client with reconnect.
- `apps/desktop/src/state/store.ts` — Frontend reactive store.
- `apps/desktop/src/state/avatar.ts` — Tauri app-data avatar persistence.
- `apps/desktop/src/mock/scriptedEvents.ts` — Realistic scripted event fixtures.
- `apps/desktop/src/mock/mockServer.ts` — Local mock WS server for independent UI testing.
- `apps/desktop/src/assets/default-penguin.placeholder.txt` — Default penguin asset slot.

### `fixtures/`, `scripts/`, `tests/e2e/`

- `fixtures/emails/normal-thread.md` [M3] — Benign thread fixture (A6/A7/A8).
- `fixtures/emails/hostile-email.md` [M3] — Prompt-injection email fixture (A15/T-08).
- `fixtures/web/hostile-page.html` [M4] — Prompt-injection web page fixture (A15).
- `scripts/dev.ps1` [M4] — Ordered Windows startup script.
- `scripts/restart-test.ps1` [M4] — Automated forced-kill + relaunch continuity test (A13/A14).
- `scripts/inject-test.ps1` [M4] — Automated hostile-content isolation test (A15).
- `tests/e2e/e2e-email-draft-send.md` [M4] — E2E email read/draft/approved send procedure.
- `tests/e2e/e2e-local-actions.md` [M4] — E2E local tools and restricted PowerShell procedure.
- `tests/e2e/e2e-restart.md` [M4] — E2E crash/restart and deduplication procedure.
- `tests/e2e/e2e-injection.md` [M4] — E2E hostile email and web injection procedure.
