# Pengu — Per-member file structure and ownership

**Maintainer:** M4 — D Venkata Abhishek (`1TD25CS079`) per workstream prompt step 2, with detail for `packages/store`, `mcp/local`, `scripts/` and `tests/e2e/`. M1 (Ronit Kapar, technical lead) owns this document's final structure and may restructure; the M1/M2/M3 one-liners below track their scaffold placeholders and will be refined when those packages land.

**Rule:** folder ownership is exclusive — only the owner edits their folders. Need a change elsewhere? Ask the owner (PR or message). `packages/contracts` changes only via M1, announced to everyone.

## Who talks to whom

| From | To | Via |
|---|---|---|
| M2 UI | M1 agent | WebSocket JSON events (7.1) on `ws://127.0.0.1:7777`, per-launch token |
| M1 agent | M3 gmail / M4 local | MCP over stdio (spawned child processes; tool manifests read by policy) |
| M1 agent | M4 store | `PenguStore` API (7.4) — every task/step/checkpoint/approval/receipt/side-effect |
| M1 agent | M3 voice | `transcribe`/`synthesize` routes mounted on the WS server (7.5) |
| M1 policy gate | UI | `approval.requested.preview` — UI renders, never computes risk, never sees tokens |
| everyone | everyone | contracts in `packages/contracts` (frozen by M1) |

---

## M1 — Ronit Kapar (`1BY25CS253`) — technical lead

**Owns:** root files, `packages/contracts/**`, `services/agent/**` (except `src/voice`), `docs/{STRUCTURE,CONTRACTS,DECISIONS}.md`, `README.md`.
**May not touch:** any other member's folders. **Ask M1 for:** contracts, stack, root config changes.

| File | One line |
|---|---|
| `README.md` | project overview, clean-clone run instructions (M4 drafted the working version; M1 owns final content) |
| `package.json` / `pnpm-workspace.yaml` / `tsconfig.base.json` | pnpm workspace root: scripts + strict TS base config (functional; M1 owns final shape) |
| `.gitignore` / `.env.example` | ignores dist/node_modules/secrets; env variable NAMES only |
| `packages/contracts/src/index.ts` | barrel re-export of all contract types |
| `packages/contracts/src/events.ts` | WS event types: `user.message`, `task.*`, `approval.*`, `pet.state`, `voice.*`, `tts.*` (7.1) |
| `packages/contracts/src/tools.ts` | `ToolManifest`/`ToolEntry` schema with riskClass, scope, previewTool (7.2) |
| `packages/contracts/src/approval.ts` | preview + HMAC token types `{approvalId, tool, argsHash, expiresAt, mac}` (7.3) |
| `packages/contracts/src/store-api.ts` | `PenguStore` interface (7.4) — M4's store implements it |
| `packages/contracts/src/voice-api.ts` | `transcribe`/`synthesize` signatures + capability table shape (7.5) |
| `services/agent/src/main.ts` | entrypoint: WS server on 127.0.0.1:7777, spawns MCP servers, mounts policy + voice |
| `services/agent/src/server/ws.ts` | WS event server implementing contract 7.1 both directions |
| `services/agent/src/server/auth.ts` | per-launch `PENGU_WS_TOKEN` issue/verify |
| `services/agent/src/llm/glm-client.ts` | GLM via Sarvam `/v2`, fixed configured model, tool calling |
| `services/agent/src/llm/prompts.ts` | prompt assembly: trusted user text separate from untrusted retrieved content |
| `services/agent/src/runtime/loop.ts` | plan → tool call → result → next step; every call through the policy gate |
| `services/agent/src/runtime/planner.ts` | request → step plan (tool/server/kind) |
| `services/agent/src/runtime/lifecycle.ts` | task lifecycle events; "completed" only after verification |
| `services/agent/src/runtime/resume.ts` | resume flow 7.6: checks, verifiers, fresh approvals |
| `services/agent/src/mcp/client.ts` | MCP stdio client; injects reserved `_meta.penguApproval` server-side |
| `services/agent/src/mcp/registry.ts` | spawns both servers, lists tools, loads + validates manifests |
| `services/agent/src/mcp/servers.config.json` | which servers to spawn and with what env |
| `services/agent/src/policy/classify.ts` | manifest-based READ/ROUTINE/CONSEQUENTIAL classification |
| `services/agent/src/policy/scope.ts` | granted-scope checks (roots/accounts/apps) |
| `services/agent/src/policy/hard-deny.ts` | deny-by-default rules: unknown class, missing manifest, unsafe command |
| `services/agent/src/policy/approval-gate.ts` | exact-action preview via previewTool, pause/resume, invalidation |
| `services/agent/src/policy/token.ts` | HMAC-SHA256 token issue/verify with `PENGU_APPROVAL_SECRET` |
| `services/agent/src/policy/policy.rules.json` | declarative policy rules |
| `services/agent/test/policy.test.ts` · `runtime.test.ts` | policy-gate and runtime-loop unit tests (replay LLM, tests only) |
| `docs/STRUCTURE.md` | this document (M1 owns final structure) |
| `docs/CONTRACTS.md` | prose form of section 7 contracts |
| `docs/DECISIONS.md` | verified GLM/Sarvam config, stack decisions |

## M2 — Suparna Darsi (`1BY25CS303`) — desktop UI

**Owns:** `apps/desktop/**`. **Ask M2 for:** UI/UX, mock events, avatar behaviour.

| File | One line |
|---|---|
| `apps/desktop/src-tauri/tauri.conf.json` | frameless, transparent, always-on-top window config |
| `apps/desktop/src-tauri/src/main.rs` | Tauri shell entrypoint |
| `apps/desktop/src/main.tsx` | React root: pet + workspace, WS client, state |
| `apps/desktop/src/windows/PetWindow.tsx` | floating pet: tap→composer, double-tap→workspace, drag-safe |
| `apps/desktop/src/windows/Composer.tsx` | compact typed-request composer |
| `apps/desktop/src/windows/Workspace.tsx` | tabs: Chat / Activity / History / Pending |
| `apps/desktop/src/components/ChatPanel.tsx` | messages + step summaries |
| `apps/desktop/src/components/ActivityTimeline.tsx` | execution timeline: step/tool/server/risk/state/approvals |
| `apps/desktop/src/components/HistoryList.tsx` | A12 history from store results |
| `apps/desktop/src/components/PendingTasks.tsx` | A13 restore view: Continue/Cancel/Leave |
| `apps/desktop/src/components/ApprovalModal.tsx` | renders exact preview; disables expired/invalid approvals |
| `apps/desktop/src/components/AvatarPicker.tsx` | choose/preview/apply/persist/reset avatar |
| `apps/desktop/src/components/MicButton.tsx` | capture → `voice.audio` |
| `apps/desktop/src/components/StatusBadge.tsx` | pet state badge (7 states) |
| `apps/desktop/src/state/wsClient.ts` | WS client with token + reconnect/status |
| `apps/desktop/src/state/store.ts` | events → renderable UI state |
| `apps/desktop/src/state/avatar.ts` | avatar persistence in Tauri app data |
| `apps/desktop/src/mock/scriptedEvents.ts` · `mockServer.ts` | contract-faithful event mock for UI-first development |
| `apps/desktop/src/assets/` | default penguin asset |

## M3 — Maneesha G (`1BY25CS170`) — Gmail MCP + voice

**Owns:** `mcp/gmail/**`, `services/agent/src/voice/**`, `fixtures/emails/**`.
**Ask M3 for:** OAuth setup, Gmail scopes, voice languages, email fixtures.

| File | One line |
|---|---|
| `mcp/gmail/tool-manifest.json` | 5 gmail tools per 7.2; `gmail_send_draft` CONSEQUENTIAL + previewTool |
| `mcp/gmail/src/server.ts` | Gmail MCP stdio server |
| `mcp/gmail/src/auth.ts` | OAuth desktop flow; tokens in OS credential store, never logged |
| `mcp/gmail/src/tools/search.ts` / `read-thread.ts` | READ tools; bodies wrapped `{untrusted:true, content}` |
| `mcp/gmail/src/tools/create-draft.ts` | ROUTINE draft; recipient from authorized thread/args only |
| `mcp/gmail/src/tools/get-draft.ts` | READ; returns to/subject/body + `contentHash` (send's previewTool) |
| `mcp/gmail/src/tools/send-draft.ts` | CONSEQUENTIAL; re-fetch → recompute hash → verify token → duplicate-safe send; exports "was this draft sent?" verifier |
| `mcp/gmail/src/untrusted.ts` | untrusted-content wrapper |
| `mcp/gmail/src/verify-token.ts` | independent HMAC token verification (second line of defence) |
| `services/agent/src/voice/stt.ts` / `tts.ts` | Sarvam Saaras STT / Bulbul TTS |
| `services/agent/src/voice/languages.ts` | capability table from current docs (STT ≠ TTS coverage) |
| `services/agent/src/voice/routes.ts` | `voice.audio`→transcript; `tts.request`→audio/unsupported |
| `fixtures/emails/normal-thread.md` · `hostile-email.md` | benign + injection fixtures (A15 email half) |

## M4 — D Venkata Abhishek (`1TD25CS079`) — local MCP, store, QA

**Owns:** `packages/store/**`, `mcp/local/**`, `fixtures/web/**`, `scripts/**`, `tests/e2e/**`, `docs/{INTEGRATION,DEMO_SCRIPT}.md`. **Ask M4 for:** store API, local scopes/allowlist, security tests, integration merges.

### `packages/store` (all implemented ✅)

| File | One line |
|---|---|
| `src/schema.sql` | six tables (tasks, steps, checkpoints, approvals, receipts, side_effects) + indexes; copied to `dist/` at build |
| `src/types.ts` | record types, status unions, `PENDING_TASK_STATUSES`, `StoreError`, id/time helpers |
| `src/sqlitedb.ts` | `SqlDatabase` driver interface; better-sqlite3 adapter + `node:sqlite` fallback; `loadSchemaSql` |
| `src/tasks.ts` | SQLite tasks repo: create/get/list/listPending/setTaskStatus (+ pauseReason folding) |
| `src/steps.ts` | SQLite steps repo: append (auto idx)/update/list; touches parent task `updated_at` |
| `src/checkpoints.ts` | single-row atomic upsert save/load with validation (crash-safe) |
| `src/approvals.ts` | upsert-by-approvalId records; get/list by task/tool |
| `src/receipts.ts` | verified-result receipts; list by task/tool |
| `src/sideeffects.ts` | idempotent begin (intent persisted BEFORE execute); complete requires begun; completed re-complete = no-op |
| `src/sqlite.ts` | `SqliteStore` composing the six repos into `PenguStore` |
| `src/memory.ts` | `MemoryStore` — same interface/semantics with snapshot-rollback transactions |
| `src/restore.ts` | `buildRestoreView` (A13 payload per 7.1) + `reconcileSideEffects` (verify/retry/ask_user, A14) + `defaultVerifiers` |
| `src/index.ts` | `PenguStore` interface, `createSqliteStore(dbPath)` / `createMemoryStore()` factories, re-exports |
| `test/store.test.ts` | contract suite over BOTH backends: lifecycle, steps, checkpoint round-trip, approvals, receipts, side effects, transaction rollback |
| `test/restore.test.ts` | restore-view shape, verifier verdicts, reconcile outcomes, MemoryStore parity |

### `mcp/local` (all implemented ✅)

| File | One line |
|---|---|
| `tool-manifest.json` | manifest per 7.2 (risk classes, scopes, previewTool, requiresApprovalToken, verifiability notes) |
| `config/local-scopes.json` | granted fs roots (env-expanded), URL policy, allowed apps — the only place paths/apps are configured |
| `config/command-allowlist.json` | read-only/info command IDs (`sys.time`, `sys.disk`, `sys.ipconfig`, `sys.process_list`, `sys.process_info`) with arg patterns + templates |
| `src/server.ts` | config loading (+ root auto-create), transport-independent core `callTool`, MCP stdio wiring, `_meta.penguApproval` extraction |
| `src/verify-token.ts` | canonicalJSON, `argsHashOf`, HMAC sign (test/gate parity) + full verify (shape/signature/expiry/tool/hash, timing-safe) |
| `src/types.ts` | denial codes, config shapes, `ToolContext`, `ApprovalMeta` |
| `src/tools/create-folder.ts` | scoped idempotent create; re-verifies realpath containment after mkdir |
| `src/tools/list-dir.ts` | scoped listing; names/types only, capped, never file contents |
| `src/tools/open-url.ts` | scheme allowlist, credential/blocked-host refusal, Chrome launch |
| `src/tools/launch-app.ts` | allowlisted appId only; fire-and-forget launch, `verifiable:false` |
| `src/tools/shell-describe.ts` | allowlist resolution, strict arg validation, resolved cwd, exact-action preview payload |
| `src/tools/shell-run.ts` | unknown/bad-args denial ⇒ not approvable; token verify vs `{commandId,args,cwd}` hash; capped no-shell execution |
| `src/platform/windows.ts` | %VAR% expansion, realpaths, containment, junction-aware escape detection, Chrome discovery (explicit path fails closed), clean-env spawn with caps |
| `test/local-server.test.ts` | 24 policy tests: scoping, traversal, junction escape, unknown command, invalid args, all token failure modes + real allowlisted run, manifest contract check |
| `README.md` | security model + honest "allowlist runner, not a sandbox" statement |

### `scripts/` (all implemented ✅)

| File | One line |
|---|---|
| `dev.ps1` | prerequisite/env-name checks, build, honest component-readiness table, start order, `-LocalOnly` stdio mode |
| `restart-test.ps1` | A13/A14 evidence generator: phase A run → `Stop-Process -Force` mid-task → phase B relaunch assertions |
| `inject-test.ps1` | A15 web-half evidence generator: serves fixture on loopback:8099, runs probe, stops server |
| `restart-harness.mjs` | node harness: phase A persists intent + creates folder + idles; phase B asserts restore, reconcile, no duplicates, resume |
| `inject-serve.mjs` | minimal loopback static server for the hostile fixture |
| `inject-probe.mjs` | extracts `data-pengu-*` payloads, feeds each to the Local MCP core, asserts every attack denied + sandbox untouched |

### `tests/e2e/` + `fixtures/web/` + `docs/` (M4-owned docs ✅)

| File | One line |
|---|---|
| `tests/e2e/e2e-local-actions.md` | A10/A11/A12 procedure with pass criteria |
| `tests/e2e/e2e-restart.md` | A13/A14 procedure incl. Gmail restart leg + duplicate-safety spot check |
| `tests/e2e/e2e-injection.md` | A15 web+email procedure; automated server-half + model-half steps |
| `tests/e2e/e2e-email-draft-send.md` | A6–A8/A14 email procedure incl. refusal matrix |
| `fixtures/web/hostile-page.html` | A15 fixture with machine-readable `data-pengu-*` attack payloads |
| `docs/INTEGRATION.md` | dependency graph, per-member DoD, handshake tests T-01…T-12, gates, run book, sign-off |
| `docs/DEMO_SCRIPT.md` | timed A1–A15 walkthrough, deliberate failure case, backup plan, QA checklist |
