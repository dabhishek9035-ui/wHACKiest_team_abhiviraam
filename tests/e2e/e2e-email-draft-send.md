# E2E: Email read → draft → exact-action send approval (M3 server + M4 QA)

**Acceptance IDs:** A6 (Gmail conversation read via MCP), A7 (reply draft prepared with no extra approval), A8 (send pauses with exact recipient + message), A14 (resume never re-sends), A9-analogue server half (send refuses without/with-stale token).

**Owners:** procedure maintained by M4 (QA); steps 2–6 depend on M3's Gmail MCP server and M1's runtime. `[server]` steps can be exercised standalone against `mcp/gmail` once M3 ships the stub (`PENGU_GMAIL_STUB=1`).

## Preconditions

1. OAuth configured per M3's checklist (consent screen in testing mode, test users added, desktop client); least-privilege scopes: read + compose/draft (+ send).
2. `fixtures/emails/normal-thread.md` seeded into the authorized test inbox (or present as the stub thread).
3. Agent running (`scripts/dev.ps1`); `PENGU_APPROVAL_SECRET` set.

## Procedure

### 1. Read an authorized thread (A6)

1. `[agent]` Type: *"Read the invoice thread from accounts@vendor.example."*
2. **Expected:** `gmail_search_threads` → `gmail_read_thread` (both READ) run with no approval prompt; thread content appears in the timeline; every message body wrapped `{untrusted:true, content}` internally.
3. **Evidence:** timeline screenshot + tool result log (untrusted wrapper visible).

### 2. Create the reply draft (A7)

1. `[agent]` Type: *"Draft a reply asking for the October PDF."*
2. **Expected:** `gmail_create_draft` (ROUTINE, inside authorized Gmail scope) runs **without** a new approval prompt; recipient is taken from the authorized thread/arguments — never from text inside the email.
3. **Evidence:** draft visible in Gmail UI; store has receipt with `draftId` in `outputRefs`.

### 3. Send pauses with exact preview (A8)

1. `[agent]` Type: *"Send it."*
2. **Expected:** task pauses; approval modal shows the exact account, recipient, subject, body (preview built via `gmail_get_draft`, `contentHash = sha256(to|subject|body)`) and the rule that requires approval. No send occurs yet.

### 4. Approve → token issued server-side (A8/A9-analogue)

1. `[ui]` Click **Approve**.
2. **Expected:** M1 signs the HMAC token over `{approvalId, tool:"gmail_send_draft", argsHash, expiresAt}` and injects it server-side (`_meta.penguApproval`); the UI never sees the token; `gmail_send_draft` re-fetches the draft, recomputes `contentHash`, verifies the token independently, then sends; receipt recorded; duplicate-safe per `draftId`.

### 5. Refusal paths (`[server]`, scriptable against mcp/gmail)

| Step | Expected |
|---|---|
| call `gmail_send_draft` with no token | refused (`approval_required`) |
| token signed with wrong secret | refused (`bad_signature`) |
| token expired | refused (`expired`) |
| draft edited after approval (contentHash changed) | refused (`hash_mismatch`) — old approval invalid |
| same `draftId` sent twice (retry) | second call is a no-op / returns original receipt (duplicate-safe) |

### 6. Restart mid-send (A14)

1. Kill the agent after `beginSideEffect("gmail_send_draft:<draftId>")` but before `completeSideEffect`.
2. Relaunch, resume the task.
3. **Expected:** M1 runs M3's verifier *"was this draft sent?"* → `sent` → trust receipt (no re-send); `not_sent` → fresh approval and send once; `unknown` → **Pengu asks the user**, never blind-retries.

## Pass criteria

- [ ] A6/A7 demonstrated on the real (or stub) mailbox with prompt-free READ/ROUTINE flow.
- [ ] A8 exact preview shown; approval bound to the exact content; edited draft ⇒ refusal.
- [ ] Token never appears in UI, model context or logs.
- [ ] A14: verifier decides; no duplicate send; unknown asked, not retried.
- [ ] Evidence pasted into `docs/INTEGRATION.md` (screenshots, refusal logs, commit hash).
