# Pengu — Integration Plan

**Owner:** M4 — D Venkata Abhishek (`1TD25CS079`), project/team lead and integration owner.
Each member drafts their own section; this document (maintained by M4) is the version that gets committed and signed off. Evidence entries carry: commit hash + output/screenshot path + owner initials + M4 re-check initials.

**Current branch state (2026-11-22):** all M4 workstream code (store, local MCP, scripts, fixtures, e2e, docs) landed on branch **`member-4`** of `https://github.com/dabhishek9035-ui/wHACKiest_team_abhiviraam.git`. M1–M3 land on `m1/*`, `m2/*`, `m3/*`; everything merges into `main` per §4, M4 merging. `main` must always run from a clean clone.

---

## 1. Dependency graph and integration order

```
packages/contracts (M1)                      ← frozen FIRST; everyone imports these types
     │
     ├─→ services/agent (M1)                 ← runtime, policy gate, MCP client, WS server
     │        │
     │        ├─→ packages/store (M4)        ← called for every task/step/checkpoint/side-effect
     │        │        └─ in-memory twin published early so M1 is never blocked  ✅ shipped
     │        │
     │        ├─→ mcp/local (M4)  (stdio)    ← spawned by agent; manifest read by policy   ✅ shipped
     │        ├─→ mcp/gmail (M3)  (stdio)    ← spawned by agent; manifest read by policy
     │        └─→ voice/ (M3)                ← routes mounted on the WS server
     │
     └─→ apps/desktop (M2)  ← consumes WS events (7.1); builds against the event mock
```

Integration order (each step unblocks the next):

| # | Step | Owner | Status |
|---|---|---|---|
| 1 | Canonical scaffold + `.env.example` + root configs | M1 | ✅ root configs functional (M4 drafted; M1 owns) |
| 2 | `packages/contracts` frozen and published | M1 | ⏳ (files are scaffold placeholders) |
| 3 | Stubs: in-memory store, UI event mock, Gmail stub (`PENGU_GMAIL_STUB=1`), voice stub | M4 / M2 / M3 / M3 | ✅ store (in-memory + SQLite) · ⏳ others |
| 4 | Handshake tests T-01…T-12 (§3) green against mocks | all | ◐ T-05/T-06/T-07/T-12 (M4 halves) runnable today |
| 5 | Real vertical slice: typed request → GLM → Gmail read/draft → UI timeline | M1+M3+M2 | ⏳ |
| 6 | Trust & continuity: approvals, denials, restart/resume, hostile content | M1+M4(+M3) | ◐ M4 halves automated |
| 7 | Release candidate: full demo on `main` + backup recording | M4 coordinates | ⏳ |

Contract changes: **only via M1**, announced to all workstreams immediately; M4 validates and merges the PR. Deny-by-default applies everywhere: unknown risk class, missing manifest or failed scope check ⇒ deny.

---

## 2. Per-member Definition of Done

Each item: **(a)** exact verification, **(b)** expected result, **(c)** evidence to paste, **(d)** acceptance IDs. Status is honest — unchecked means not yet demonstrated.

### M1 — Ronit Kapar (`1BY25CS253`) — agent core, contracts, policy gate

| # | DoD item | (a) Verify with | (b) Expected | (c) Evidence | (d) A-IDs | Status |
|---|---|---|---|---|---|---|
| M1-1 | Contracts frozen and imported by all | `pnpm --filter @pengu/contracts build` + imports compile in agent/M3/M4 | builds clean; no member defines its own copy of contract types | build output | all | ☐ |
| M1-2 | GLM model verified via Sarvam `/v2` smoke test | real tool-calling call from `services/agent` | model ID, endpoint, request/response shape recorded in `docs/DECISIONS.md` | log + DECISIONS entry | A3 | ☐ |
| M1-3 | Agent lists real tools from both MCP servers and loads manifests | T-02, T-11 | tool list = 5 gmail + 6 local, manifest matches contract 7.2 | T-02/T-11 output | A5 | ☐ |
| M1-4 | Typed request → plan → tool calls → events stream | run agent; send `user.message` | `task.created` → `task.step…` → `task.finished` on the WS; timeline renders | event log + screenshot | A3, A5 | ☐ |
| M1-5 | Policy gate: routine flows without per-task prompt; consequential pauses with exact preview | A6–A8, A11 flows in e2e docs | no prompt for READ/ROUTINE in scope; modal shows exact action for send/shell | screenshots | A6–A8, A11 | ☐ |
| M1-6 | Unsafe/unknown commands denied even if user would approve | T-05 + gate-level denial of `download-payload` | `denied`, not approvable, no modal | denial log | A9 | ☐ |
| M1-7 | Stale/expired approval rejected | T-04 (draft edited after approval) | send refuses (`hash_mismatch`) | refusal log | A8, A9 | ☐ |
| M1-8 | Resume flow: fresh approval for unexecuted consequential steps; side effects verified | T-06, T-07 | pending task resumes; no duplicate send/create; unknown ⇒ asked | script/e2e output | A13, A14 | ☐ |
| M1-9 | Hostile content labelled untrusted; no tool call from email/web | T-08, T-12 | model emits no tool call from page/email content | event log | A15 | ☐ |
| M1-10 | WS server auth: per-launch `PENGU_WS_TOKEN`; unauthenticated sockets rejected | connect without token | rejected with `error` event | log | A1 | ☐ |

### M2 — Suparna Darsi (`1BY25CS303`) — desktop UI

| # | DoD item | (a) Verify with | (b) Expected | (c) Evidence | (d) A-IDs | Status |
|---|---|---|---|---|---|---|
| M2-1 | Pet window: frameless, transparent, always-on-top; single tap composer, double tap workspace; drag ≠ tap | launch app; interaction test | correct behaviour on Windows 10/11 | screen recording | A1 | ☐ |
| M2-2 | Avatar choose/preview/apply/persist/reset | pick PNG, restart app, reset | persists across restart; reset restores default penguin | screenshots | A2 | ☐ |
| M2-3 | Event mock published and rendered (timeline, states, approvals) | T-01 | mock stream renders honest states | screenshot | A5 | ☐ |
| M2-4 | Real WS client: connect with token, reconnect + connection status | run against real agent | status badge reflects connection; events render | screenshot | A3 | ☐ |
| M2-5 | ApprovalModal renders exact preview; never shows Approve when required preview fields missing; disabled when expired/invalidated | A8 preview; tamper case | exact recipient/command shown; Approve disabled | screenshots | A8 | ☐ |
| M2-6 | Voice path: mic → `voice.audio`; show transcript before consequential execution; play `tts.audio`; explicit `tts.unsupported` reason | spoken demo | transcript + audio + honest unsupported handling | recording | A4 | ☐ |
| M2-7 | Startup restore: Pending tab lists pending tasks with Continue/Cancel/Leave | restart app with unfinished task | restore view from `task.list.tasks[]` incl. pauseReason/outputRefs | screenshot | A13 | ☐ |
| M2-8 | History tab renders operations + results from the store | A12 flow | every operation with result; honest states only | screenshot | A12 | ☐ |

### M3 — Maneesha G (`1BY25CS170`) — Gmail MCP + voice

| # | DoD item | (a) Verify with | (b) Expected | (c) Evidence | (d) A-IDs | Status |
|---|---|---|---|---|---|---|
| M3-1 | OAuth setup reproducible (consent screen testing mode, test users, desktop client, least-privilege scopes) | follow M3 checklist | any teammate can reproduce; no scope broadening | checklist + console screenshots | A6 | ☐ |
| M3-2 | Gmail stub mode `PENGU_GMAIL_STUB=1` published early | spawn server with stub env | canned threads/drafts returned over stdio | T-02 partial output | A6, A7 | ☐ |
| M3-3 | A6: real authorized thread read via MCP (not mock) | e2e-email-draft-send.md §1 | thread content returned; bodies wrapped `{untrusted:true, content}` | tool result log | A6 | ☐ |
| M3-4 | A7: reply draft created without extra approval | e2e-email-draft-send.md §2 | draft exists in Gmail; receipt recorded | screenshot + store row | A7 | ☐ |
| M3-5 | A8 server half: send refuses without token / wrong secret / expired / edited draft; sends exactly approved content | e2e-email-draft-send.md §5 | all refusals logged; send matches preview | refusal logs | A8 | ☐ |
| M3-6 | Duplicate-safe send per `draftId`; verifier `sent/not_sent/unknown` for resume | T-07 email leg | no double send; unknown asked, not retried | verifier output | A14 | ☐ |
| M3-7 | Voice: Saaras STT + Bulbul TTS in the demo language; capability table from current docs; unsupported ⇒ explicit | T-10 | transcript + audio round trip; honest unsupported | T-10 output | A4 | ☐ |
| M3-8 | Hostile email wrapped untrusted; no recipient change | T-08 | recipient stays authorized; no send | T-08 output | A15 | ☐ |
| M3-9 | No tokens/keys in repo, logs or prompts | `git grep` + log review | clean | grep output | all | ☐ |

### M4 — D Venkata Abhishek (`1TD25CS079`) — local MCP, store, QA

| # | DoD item | (a) Verify with | (b) Expected | (c) Evidence | (d) A-IDs | Status |
|---|---|---|---|---|---|---|
| M4-1 | Store unit tests green (SQLite **and** in-memory twins) | `pnpm --filter @pengu/store test` | **35 passed (35)** on 2026-11-22 | test output below | A12–A14 halves | ✅ |
| M4-2 | Local MCP policy tests green | `pnpm --filter @pengu/local-mcp test` | **24 passed (24)** on 2026-11-22 | test output below | A9/A11 halves | ✅ |
| M4-3 | A9 server half: shell_run_restricted without valid unexpired token ⇒ refused; unknown command / invalid args ⇒ denied, not approvable; allowlisted run only with exact token, fixed cwd, timeout, capped output | `pnpm --filter @pengu/local-mcp test` (shell policy suite) | refusal codes: `approval_required`, `expired`, `bad_signature`, `tool_mismatch`, `hash_mismatch`, `unknown_command`, `invalid_args`; real `sys.echo` run exits 0 only with exact token | test output | A9 | ✅ (server half) |
| M4-4 | A10: Chrome opens, URL opens, allowlisted app launches — from real agent requests | e2e-local-actions.md §3–4 (needs agent) + tool halves via unit tests | Chrome + Notepad open; scheme/app denials proven | screenshots + unit output | A10 | ◐ halves ✅ |
| M4-5 | A11: folder created inside approved root with no per-task approval; outside root ⇒ denied | e2e-local-actions.md §1–2 + unit tests | no modal inside root; `path_outside_scope`/`path_traversal`/`symlink_escape` outside | screenshots + unit output | A11 | ◐ halves ✅ |
| M4-6 | A12: history shows each operation and its result from the store | e2e-local-actions.md §5 + store receipt tests | history matches `listReceipts`/steps | screenshots | A12 | ◐ store half ✅ |
| M4-7 | A13: forced kill + relaunch ⇒ unfinished task reappears with correct state | `powershell -File scripts/restart-test.ps1` | **RESTART_TEST_PASS** — task pending, steps done/planned, outputRefs intact (run 2026-11-22) | script output + evidence dir | A13 | ✅ (store/tool level) |
| M4-8 | A14: resume doesn't duplicate completed side effects; undeterminable asked, not retried | same script (phase B assertions) | exactly 1 folder, 1 receipt; `completed_as_verified`; unknown ⇒ `ask_user` | script JSON output | A14 | ✅ (store/tool level) |
| M4-9 | A15 web half: hostile page produces no tool effect and no approvable request | `powershell -File scripts/inject-test.ps1` | **INJECT_TEST_PASS** — 7/7 attacks denied, sandbox untouched (run 2026-11-22) | probe JSON | A15 | ✅ (web half) |
| M4-10 | e2e docs executed once on `main` with evidence pasted | run all four `tests/e2e/*.md` | each doc's pass-criteria checked | evidence links here | A6–A15 | ☐ (needs M1–M3 on main) |
| M4-11 | `main` runs from clean clone via `scripts/dev.ps1` | fresh `git clone` → `dev.ps1` | readiness table + starts what exists | script output | all | ☐ (after merge) |
| M4-12 | Demo script + backup recording ready | follow `docs/DEMO_SCRIPT.md` QA checklist | checklist all green before recording | recording | all | ☐ |

Evidence already generated in this working tree (2026-11-22):

```
packages/store test:      Tests  35 passed (35)
mcp/local test:           Tests  24 passed (24)
restart-test.ps1:         === RESULT: PASS (A13 + A14) ===  (RESTART_TEST_PASS)
inject-test.ps1:          === RESULT: PASS (A15 web half) ===  (INJECT_TEST_PASS)
```
Commit hash for this evidence: *(fill at sign-off — M4 re-runs the four commands on `main` and pastes `git log -1` hash here)*.

---

## 3. Handshake tests (pair-wise)

| ID | Pair | What it proves | How to run | Expected | Status |
|---|---|---|---|---|---|
| T-01 | UI ↔ agent (mock) | event mock renders timeline/states/approvals | M2 mock server + workspace | honest states render | ☐ |
| T-02 | agent ↔ both MCP servers | spawn over stdio, list tools, load manifests | agent registry vs both `tool-manifest.json` | 5 gmail + 6 local tools, contract-7.2 classes | ☐ |
| T-03 | agent ↔ Gmail MCP | `gmail_send_draft` without valid token refused | call tool with no `_meta.penguApproval` | `approval_required` refusal | ☐ |
| T-04 | agent ↔ Gmail MCP | draft edited after approval ⇒ send refuses | approve, then edit draft, then send | `hash_mismatch` refusal | ☐ |
| T-05 | agent ↔ Local MCP | unknown `commandId` denied (not approvable) | `shell_run_restricted {commandId:"download-payload"}` | `unknown_command`, `denied:true` | ✅ (covered by `pnpm --filter @pengu/local-mcp test`) |
| T-06 | agent ↔ store | kill agent mid-task → relaunch ⇒ task pending | `scripts/restart-test.ps1` | **RESTART_TEST_PASS** | ✅ (store/tool level) |
| T-07 | agent ↔ store ↔ MCP | resume does not re-send / re-create / duplicate | same script phase B | 1 folder, 1 receipt; `completed_as_verified` | ✅ (store/tool level) |
| T-08 | agent ↔ Gmail ↔ policy | hostile email ⇒ no tool call, no recipient change | e2e-injection.md email leg (M3 fixture) | untrusted wrapper; authorized recipient only | ☐ |
| T-09 | agent ↔ store | store API round trip via contract types (task→steps→checkpoint→approval→receipt→side effect) | store test suite | 35/35 green | ✅ |
| T-10 | agent ↔ voice | `voice.audio` → `voice.transcript` → `tts.audio` / `tts.unsupported` | voice route round trip (M3) | round trip in demo language; honest unsupported | ☐ |
| T-11 | agent ↔ Local MCP | full stdio handshake incl. token injection via `_meta` | MCP inspector or agent; `shell_run_restricted` with M1-issued token | refusal without token; run with token | ◐ (server half ✅) |
| T-12 | agent ↔ policy ↔ Local MCP | hostile **web** page: no tool call and no approvable request | `scripts/inject-test.ps1` (server half) + e2e-injection.md (model half) | **INJECT_TEST_PASS**; model half ☐ | ◐ |

---

## 4. Milestone sync schedule (G0–G5) and branch rules

Run a short sync whenever a gate is reached and before any cross-workstream contract change. At each sync: check dependencies for the next gate, confirm stubs still match frozen contracts, assign one owner per blocker, merge only tested PRs, record commit hash + acceptance IDs + evidence here.

| Gate | Exit condition | What must be green | Status |
|---|---|---|---|
| G0 — repository & setup | canonical scaffold; secrets guidance; OAuth/Sarvam blockers identified; repo ready for 24 Nov link | clean-clone instructions, `.env.example`, setup checklist | ✅ scaffold + docs; ☐ blockers page in DECISIONS |
| G1 — contracts & stubs | M1 freezes contracts; all stubs published; nobody blocked | `packages/contracts`, manifests, UI mock, in-memory store (✅), Gmail/local stubs, voice stub | ◐ store stub done |
| G2 — component handshakes | T-01…T-12 pass against mocks/stubs | handshake outputs logged here | ◐ T-05/06/07/09/12(server) ✅ |
| G3 — first real vertical slice | typed request → GLM → Gmail read/draft → UI progress | commit hash, e2e recording, receipt | ☐ |
| G4 — trust & continuity | exact-action approvals; unsafe denied; restart-safe resume; hostile tests | A8/A9/A13/A14/A15 evidence | ◐ server halves ✅ |
| G5 — release candidate | voice, avatar, local actions, history, restore, failure states tested together on `main` | acceptance checklist, sign-offs, backup recording | ☐ |

**Branch rules:** branches named `m1/*`, `m2/*`, `m3/*`, `m4/*` (the current M4 workstream branch is `member-4`); PRs target `main`; **M4 merges** and only after re-running the PR's Definition-of-Done checks; `main` always runs from a clean clone; after the agreed release-candidate point, merge only regression-passing fixes. Repository URL submitted 24 Nov 2026 is final — all work continues on that repository through the 26–27 Nov presentations.

---

## 5. How to run everything

```powershell
git clone https://github.com/dabhishek9035-ui/wHACKiest_team_abhiviraam.git
cd wHACKiest_team_abhiviraam            # checkout the workstream branch being tested
pnpm install
copy .env.example .env                  # fill values locally; NEVER commit
pnpm build
pnpm test                               # 35 store + 24 local-server tests
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/dev.ps1
```

**Start order** (dependency order):

1. Environment: `SARVAM_API_KEY`, `PENGU_APPROVAL_SECRET`, `PENGU_WS_TOKEN`, `GOOGLE_CLIENT_ID/SECRET` (names in `.env.example`; values never echoed/logged/committed).
2. Build: `pnpm -r build` (contracts → store → agent → mcp/* → apps/*).
3. **`services/agent` starts first** — it listens on **`ws://127.0.0.1:7777`** (the only TCP port) with the per-launch `PENGU_WS_TOKEN`, and **spawns both MCP servers over stdio itself** (`mcp/local`, `mcp/gmail` — stdio = no ports).
4. `apps/desktop` connects to the WS as a client.
5. Test-only: `scripts/inject-serve.mjs` serves the hostile fixture on `127.0.0.1:8099` (loopback, started/stopped by `inject-test.ps1`).

**Ports summary:** 7777/TCP (agent WS, loopback) · 8099/TCP (fixture server during `inject-test.ps1` only) · everything else stdio.

**`dev.ps1 -LocalOnly`** runs `mcp/local` standalone over stdio for manual MCP-inspector testing (`npx @modelcontextprotocol/inspector node mcp/local/dist/server.js`).

**Forced-restart procedure** (what A13/A14 demos): close or `Stop-Process -Force` the agent sidecar mid-task (or log off / shut down — identical semantics) → relaunch via `scripts/dev.ps1` → Pending tab shows unfinished tasks with step states + pause reason → Continue → verifiers run (folder ⇒ verified; URL/app ⇒ unknown ⇒ ask; unexecuted consequential steps ⇒ fresh approval; approvals never survive a restart). Automated equivalent: `scripts/restart-test.ps1`.

---

## 6. How a job is marked done

1. The **owner** ticks their DoD checkbox in §2 and appends: commit hash (of the evidence run) + evidence (command output / screenshot path / recording link).
2. **M4 re-runs the same check on `main`** (clean clone), confirms identical results, and initials the row.
3. Only M4-initialled rows count toward gate exit conditions. If something cannot be demonstrated, it is stated plainly here rather than quietly adjusted — the test is never changed to make a demo pass.

Sign-off table (one row per member; fill as items close):

| Member | Workstream | DoD items closed | Evidence commit(s) | Owner initials | M4 re-check initials |
|---|---|---|---|---|---|
| Ronit Kapar | M1 | — | — | — | — |
| Suparna Darsi | M2 | — | — | — | — |
| Maneesha G | M3 | — | — | — | — |
| D Venkata Abhishek | M4 | M4-1, M4-2, M4-3, M4-7, M4-8, M4-9 (halves) | *(this branch — fill hash at merge)* | DVA | *(M4 is the signer; re-run on `main` at merge)* |

---

## 7. End-to-end demo flow + deliberate failure case

Full timed walkthrough with per-section A-IDs, backup recording plan and the pre-recording QA checklist lives in **`docs/DEMO_SCRIPT.md`**. Summary:

1. Pet + workspace + avatar persist (A1, A2)
2. Typed request → visible plan (A3, A5)
3. Voice round trip, honest `unsupported` (A4)
4. Gmail read + draft, untrusted wrapper visible (A6, A7)
5. Send pauses with exact preview → approve → sent (A8)
6. Local actions: folder (no prompt), URL, app (A10, A11) + history (A12)
7. **Deliberate failure case, shown honestly:** unknown shell command **denied even if the user would approve** (A9 — "allowlist runner, not a sandbox"); approval of a safe command then **denied** by the user (nothing runs); hostile page read ⇒ **no tool call, no approval request** (A15, cite `INJECT_TEST_PASS`)
8. Forced kill mid-task → relaunch → restore → resume without duplicates (A13, A14)

---

## 8. Known limitations and honest claims

- The restricted shell is an **allowlist runner, not an OS-level sandbox** — it prevents the agent from running anything outside the allowlist; it does not contain a determined attacker.
- **GLM reasoning and Sarvam speech are cloud API processing.** Task state, history, policy decisions and approvals are stored/enforced locally.
- Gmail surface is read/search/draft/send only; Calendar/Drive and arbitrary form submission are deferred (optional expansion after core passes, agreed by M1 + M4).
- URL-open and app-launch outcomes are **not locally verifiable**: they are recorded as intent-only and marked `unknown` on resume — Pengu asks the user rather than retrying.
- "Completed" is shown only after verification; partial failure is reported as partial.
- Approvals are bound to the exact action and **never survive a restart**; any material change invalidates the old approval.
- Voice/language support claims come from the verified capability table; unsupported combinations return an explicit `unsupported` result.
- Current build state: M4 packages implemented and tested; M1–M3 packages are scaffold placeholders until their owners land them.
