# Pengu Integration Plan & Definition of Done (`docs/INTEGRATION.md`)

- **Integration Owner:** M4 — D Venkata Abhishek (`1TD25CS079`), Project/Team Lead
- **Technical Lead (Contracts):** M1 — Ronit Kapar (`1BY25CS253`)
- **Contributors:** M1 (Ronit), M2 (Suparna Darsi — `1BY25CS303`), M3 (Maneesha G — `1BY25CS170`), M4 (Abhishek)
- **Repository Rule:** Submit the canonical GitHub repository link by **24 November 2026** and push all subsequent commits to that same repository through the **26–27 November 2026** presentations.

---

## 1. Dependency Graph & Integration Order

```text
Step 0: Canonical Scaffold + Docs (G0)
   └─► M1 freezes @pengu/contracts (G1)
         ├─► M2 publishes mock/scriptedEvents.ts + mockServer.ts
         ├─► M3 publishes mcp/gmail (PENGU_GMAIL_STUB=1) + voice stub
         ├─► M4 publishes @pengu/store (in-memory stub) + mcp/local stub
         └─► Handshake Tests T-01..T-08 against stubs (G2)
               └─► Replace stubs with live GLM + Gmail + Local + SQLite + Voice (G3 → G4 → G5)
```

Integration order: **Contracts (`@pengu/contracts`) → Stubs/Mocks → Pairwise Handshakes → Vertical Slice → Trust & Continuity → Full Release Candidate**.

---

## 2. Per-Member Definition of Done

### M1 — Agent Core, Policy Gate & Contracts (Ronit Kapar)

| # | Requirement | Verification Command / Steps | Expected Observable Result | Evidence to Paste | A-IDs |
|---|---|---|---|---|---|
| M1-1 | Contracts frozen & imported by all packages | `pnpm --filter @pengu/contracts build && pnpm -r typecheck` | Zero TypeScript errors across all workspaces | Build/typecheck log + commit hash | All |
| M1-2 | GLM `glm5.3` smoke test verified on Sarvam `/v2` | `pnpm --filter @pengu/agent smoke:glm` | HTTP 200 with valid tool call from `glm5.3`; `reasoning_content` stripped from UI events | Redacted log in `docs/DECISIONS.md` | A3, A5 |
| M1-3 | Agent lists real tools from both MCP servers & loads manifests | `pnpm --filter @pengu/agent test` (T-02) | Registry lists all 5 Gmail tools + 6 Local tools with manifest risk classes | Test output | A6–A11 |
| M1-4 | Typed request → plan → tool calls → WS events stream | Run agent + UI or WS client with typed request | `task.created`, `task.step`, `pet.state`, `task.finished` emitted in order | WS event log + screenshot | A3, A5 |
| M1-5 | Policy gate enforces routine vs. consequential & hard-deny | `pnpm --filter @pengu/agent test` (T-03, T-04, T-05) | READ/ROUTINE in scope run without prompt; send/shell pause with exact preview; unknown shell denied; edited draft invalidates approval | `policy.test.ts` pass output | A6, A7, A8, A9, A10, A11 |
| M1-6 | Hostile-content isolation | `pnpm --filter @pengu/agent test` (T-08) | Hostile email/web payload wrapped `untrusted:true`; zero unauthorized tool calls or recipient changes | `runtime.test.ts` pass output | A15 |
| M1-7 | Restart-safe resume verifies side effects & requires fresh approval | `pnpm --filter @pengu/agent test` (T-06, T-07) | Completed side effects skipped; incomplete verified or asked; pending consequential step requires fresh approval | `runtime.test.ts` pass output | A13, A14 |
| M1-8 | Clean-clone runnable on `main` | Clone repo, `pnpm install`, `.\scripts\dev.ps1` | Services start cleanly without manual patches | Terminal output | All |

### M2 — Desktop UI (Suparna Darsi)

| # | Requirement | Verification Command / Steps | Expected Observable Result | Evidence to Paste | A-IDs |
|---|---|---|---|---|---|
| M2-1 | Floating pet window behavior | Launch Tauri app; drag, single-tap, double-tap pet | Always-on-top transparent pet; drag does not trigger tap; single tap opens Composer; double tap opens Workspace | Screen recording / screenshot | A1 |
| M2-2 | Avatar customization & persistence | Choose PNG/JPG/WebP → preview → Apply → restart app → Reset | Custom image persists across restart; Reset restores default penguin | Before/after screenshots | A2 |
| M2-3 | Typed chat & live timeline (mock + live) | Run against `mockServer.ts`, then live `ws://127.0.0.1:7777` | Identical screens rendering `task.step`, risk class, redaction toggle, honest `StatusBadge` | Screenshot + log | A3, A5 |
| M2-4 | Voice UI path | Click `MicButton`, speak supported language; test unsupported TTS | Transcript shown before consequential step; `tts.audio` plays or `tts.unsupported` reason shown | Screenshot / recording | A4 (UI) |
| M2-5 | ApprovalModal safety | Trigger `approval.requested`, wait for expiry / trigger `approval.invalidated` | Exact recipient/body or commandId/args/cwd/purpose/impact displayed; Approve disabled on expiry, invalidation, or missing fields | Screenshot | A8 (UI) |
| M2-6 | History & Startup Restore | Restart with pending task; open History & Pending tabs | History lists verified outcomes; Pending shows Continue/Cancel/Leave and "needs a fresh approval" notice | Screenshot | A12, A13 |

### M3 — Gmail MCP & Sarvam Voice (Maneesha G)

| # | Requirement | Verification Command / Steps | Expected Observable Result | Evidence to Paste | A-IDs |
|---|---|---|---|---|---|
| M3-1 | Least-privilege Gmail OAuth & live thread read | Run Gmail MCP against authorized test account (`gmail_read_thread`) | Real thread fetched; message bodies/attachments wrapped `{untrusted:true, content}`; tokens never logged | Redacted log | A6, A15 |
| M3-2 | Routine draft creation & preview hash | Call `gmail_create_draft` and `gmail_get_draft` | Draft created without per-task approval; `gmail_get_draft` returns deterministic `contentHash = sha256(to\|subject\|body)` | Test output + Gmail screenshot | A7 |
| M3-3 | Token-verified duplicate-safe send | Run T-03 and T-04 against `mcp/gmail` | Missing/invalid/expired token refused; edited draft refused; valid token sends once per `draftId`; verifier returns sent/`unknown` | Test log + sent mail proof | A8 (server) |
| M3-4 | Sarvam Saaras STT & Bulbul TTS routes | Test `voice/routes.ts` in English + 1 verified Indian language + 1 unsupported TTS language | Accurate transcript + playable audio for supported languages; explicit `{unsupported:true, reason}` otherwise | Test output | A4 (service) |
| M3-5 | Email fixtures | Inspect `fixtures/emails/{normal-thread,hostile-email}.md` | Fixtures seed test inbox and pass A15 injection check | Fixture test output | A15 |

### M4 — Local MCP, SQLite Store, Continuity & QA (D Venkata Abhishek)

| # | Requirement | Verification Command / Steps | Expected Observable Result | Evidence to Paste | A-IDs |
|---|---|---|---|---|---|
| M4-1 | SQLite store & restore unit tests | `pnpm --filter @pengu/store test` | Atomic transactions, checkpoints, approvals, receipts, side effects, and restore queries pass | Test output | A12, A13, A14 |
| M4-2 | Local routine tools & path safety | Run `mcp/local` tests (`fs_create_folder`, `fs_list_dir`, `browser_open_url`, `app_launch`) | Approved root folder created idempotently without prompt; traversal/`..`/symlink outside root denied; Chrome URL & allowlisted app launch | Test output + screenshot | A10, A11 |
| M4-3 | Restricted PowerShell allowlist runner | Run T-05 + token verification tests on `shell_run_restricted` | Unknown commandId / bad args / missing or mismatched HMAC token refused; allowlisted command runs with fixed cwd, timeout, output cap | Test output | A9 (server) |
| M4-4 | Forced restart & injection scripts | Run `.\scripts\restart-test.ps1` and `.\scripts\inject-test.ps1` | Pending task reappears after kill; no duplicate folder/draft/send; hostile page triggers zero tool calls | Script output | A13, A14, A15 |
| M4-5 | E2E procedures & Demo Script on `main` | Execute `tests/e2e/*.md` on `main` | All A1–A15 verified and signed off; `docs/DEMO_SCRIPT.md` + backup recording ready | Signed checklist | A1–A15 |

---

## 3. Pairwise Handshake Tests

| ID | Pair | Test Procedure | Expected Result |
|---|---|---|---|
| **T-01** | UI (M2) ↔ Agent (M1) | Connect `apps/desktop` to `mockServer.ts`, then to live `services/agent` WS with auth token | Both render identical timeline, status badges, and approval modal; unauthenticated WS connection rejected with HTTP 401. |
| **T-02** | Agent (M1) ↔ Gmail & Local MCP (M3/M4) | Start `McpToolRegistry` against both stdio servers | Lists all 5 Gmail + 6 Local tools; loads `tool-manifest.json`; denies any unlisted tool. |
| **T-03** | Agent (M1) ↔ Gmail MCP (M3) | Invoke `gmail_send_draft` without token, with forged HMAC, and with expired token | Server refuses all three; succeeds only with valid unexpired HMAC token injected server-side. |
| **T-04** | Agent (M1) ↔ Gmail MCP (M3) | Approve draft `D1`, mutate draft body before send, then invoke `gmail_send_draft` | Live `contentHash` differs from signed `argsHash`; both gate and server refuse and emit `approval.invalidated`. |
| **T-05** | Agent (M1) ↔ Local MCP (M4) | Request `shell_run_restricted` with unknown `commandId` (e.g. `rm_rf`) or invalid args | Hard-denied before approval prompt; never approvable; server also refuses if invoked directly. |
| **T-06** | Agent (M1) ↔ Store (M4) | Start multi-step task, terminate agent mid-task, relaunch, send `task.list.request {filter:"pending"}` | Interrupted task reappears in `task.list` with accurate completed/pending step statuses and `pauseReason`. |
| **T-07** | Agent (M1) ↔ Store (M4) + Verifiers (M3/M4) | Resume interrupted task whose folder/draft was already created (or begun-not-completed) | Completed side effects are skipped via receipt; incomplete side effects run verifier; indeterminate outcomes pause and ask user; consequential steps request fresh approval. |
| **T-08** | Agent (M1) ↔ Gmail/Local Fixtures (M3/M4) | Read `fixtures/emails/hostile-email.md` and `fixtures/web/hostile-page.html` | External content wrapped `{untrusted:true}`; zero unauthorized tool calls, zero recipient redirects, zero approval modals triggered by hostile text. |
| **T-09** | Agent (M1) ↔ Voice Routes (M3) | Send `voice.audio` and `tts.request` over WS (supported + unsupported language) | Returns `voice.transcript`, `tts.audio` for supported language, and `tts.unsupported {reason}` for unsupported language. |

---

## 4. Milestone Sync Schedule, Gates (G0–G5) & Branch Rules

| Gate | Must Be Green To Pass | Gate Owner / Merge Owner |
|---|---|---|
| **G0 — Repository & Setup** | Canonical scaffold committed, `.env.example` documented, Google OAuth & Sarvam blockers logged, canonical GitHub repo ready for 24 Nov submission | M1 (scaffold) / M4 (merge) |
| **G1 — Contracts & Stubs** | `@pengu/contracts` frozen; M2 mock server, M3 Gmail/voice stubs, M4 in-memory store & local stub published | M1 (freeze) / M4 (merge) |
| **G2 — Component Handshakes** | T-01 through T-09 pass against stubs/mocks with logs pasted here | All / M4 signs off |
| **G3 — First Real Vertical Slice** | Live `glm5.3` smoke test green; real typed request reads authorized Gmail thread, creates draft, streams honest timeline to UI | M1 + M2 + M3 / M4 |
| **G4 — Trust & Continuity** | A8, A9, A13, A14, A15 pass end-to-end (exact approval, hard-deny, restart restore, no duplicate side effects, hostile injection blocked) | M1 + M3 + M4 |
| **G5 — Release Candidate** | A1–A15 all green on `main`, voice + avatar + local actions + history + deliberate failure demo verified, backup recording captured | M4 calls RC |

### Branch & Merge Rules

- Workstream branches: `m1/*`, `m2/*`, `m3/*`, `m4/*`.
- All changes enter `main` via tested PRs. **M4 (D Venkata Abhishek) is the merge owner.**
- `main` must stay runnable from a clean clone at all times.
- Contract changes require M1 approval and immediate announcement to all workstreams before merge.

---

## 5. How To Run Everything (`scripts/dev.ps1`)

1. Ensure `.env` exists at repo root (copied from `.env.example` with real local keys).
2. Run `.\scripts\dev.ps1` from repo root. Startup order:
   1. Validate required env vars (`SARVAM_API_KEY`, `PENGU_APPROVAL_SECRET`, etc.) without printing secret values.
   2. Initialize local SQLite database (`packages/store`).
   3. Start `services/agent` on `127.0.0.1:7777` (spawns `mcp/gmail` and `mcp/local` over stdio automatically).
   4. Launch `apps/desktop` (Tauri + React) passing the per-launch WS auth token via secure local mechanism.
3. Ports: Only `127.0.0.1:7777` (WebSocket) and Tauri Vite dev port (`1420` in dev mode) are used.

---

## 6. How a Job Is Marked Done (Sign-Off Procedure)

1. Workstream owner runs their DoD verification command on their branch and opens a PR into `main`.
2. Owner ticks their checkbox, pastes the commit hash and verification evidence (command output / log / screenshot).
3. **M4** merges the PR into `main`, re-runs the verification check on `main`, and adds their initials (`DVA`) + sign-off date.

| Item | Owner | Commit Hash | Evidence Summary | M4 Sign-Off |
|---|---|---|---|---|
| M1 Core + Policy + Contracts | Ronit (M1) | *(pending merge)* | `policy.test.ts` + `runtime.test.ts` passing | *(pending)* |
| M2 Desktop UI | Suparna (M2) | *(pending)* | *(pending)* | *(pending)* |
| M3 Gmail MCP + Voice | Maneesha (M3) | *(pending)* | *(pending)* | *(pending)* |
| M4 Local MCP + Store + QA | Abhishek (M4) | *(pending)* | *(pending)* | *(pending)* |

---

## 7. End-to-End Demo Flow & Deliberate Failure-Case Demo

1. **Happy Path (A1–A12):** Open Pengu from floating pet (A1), show persisted custom avatar (A2), issue a typed or voice request (A3/A4) to read an authorized Gmail thread (A6), draft a reply without extra approval (A7), create a folder in an approved directory (A11), open a URL in Chrome (A10), and pause for exact-action approval before sending the email (A8) and running an allowlisted PowerShell info command (A9). Inspect live timeline (A5) and history (A12).
2. **Trust & Continuity (A13–A15):** Kill the agent mid-task, relaunch, show the pending task in Restore UI (A13), click Continue and verify completed steps are not repeated while pending send requires fresh approval (A14). Read the hostile email/web fixture and confirm zero unauthorized tool calls or recipient changes (A15).
3. **Deliberate Failure / Honest State Demo:**
   - Attempt an unknown PowerShell command (`shell_run_restricted` with unapproved `commandId`) → hard-denied immediately, task reports `partial` or `failed` honestly (never `completed`).
   - Request TTS in an unsupported language → UI displays explicit `tts.unsupported` reason.

---

## 8. Known Limitations & Honest Claims

- **Cloud inference & speech:** `glm5.3` reasoning and Sarvam `saaras:v4` / `bulbul` speech use Sarvam cloud APIs; only task history, checkpoints, policy rules, and approval records are local.
- **Allowlist runner, not an OS sandbox:** `mcp/local`'s restricted PowerShell runner enforces allowlisted command IDs, validated args, fixed cwd, timeout, and output caps; it is not an OS-level containment sandbox.
- **External side-effect ambiguity:** If power is lost between an external API send and local receipt commit, Pengu marks the side effect indeterminate and asks the user rather than claiming guaranteed exactly-once delivery.
- **No hidden chain-of-thought exposure:** Pengu shows observable step plans and summaries only.
- **Deferred items:** Calendar/Drive integrations, arbitrary web form submission, cross-device sync, local inference privacy mode, and a full avatar animation editor are out of core scope.
