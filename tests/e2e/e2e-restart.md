# E2E: Restart safety — kill mid-task, relaunch, resume without duplicates (owner: M4)

**Acceptance IDs:** A13 (unfinished task reappears after app/laptop restart), A14 (resume doesn't repeat a completed operation; undeterminable ones are asked, not retried).

**Status:** the store/tool-level cycle is automated and green today (2026-11-22): `scripts/restart-test.ps1` → **RESTART_TEST_PASS**. The `[agent]`/`[ui]` steps below must be run once on `main` after M1's runtime + M2's restore UI land (before the G4 gate).

## Automated tool-level evidence (run now)

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/restart-test.ps1
```

What the script proves, with evidence in `%TEMP%\pengu-restart-test-<stamp>`:

1. **Phase A** — harness creates task *"Create the invoices folder inside PenguSandbox and list it"*, appends 2 steps, saves a checkpoint, persists the side-effect **intent** (`beginSideEffect`), creates the folder via the Local MCP core, records the receipt, then idles. Script force-kills the process (`Stop-Process -Force`) = crash mid-task with a begun-but-not-completed side effect.
2. **Phase B** — fresh process opens the same SQLite DB and asserts:
   - task reappears in `listPending()` with status `running` (**A13**);
   - `buildRestoreView` shows steps `done`/`planned`, output ref `folderPath`, account context;
   - `reconcileSideEffects` verdict for the folder side effect is `verified` → `completed_as_verified` with evidence (**A14**);
   - exactly **1** `reports` folder exists (no duplicate creation) and exactly **1** receipt;
   - the remaining `fs_list_dir` step resumes and the task honestly reaches `completed`.

Expected output ends with `RESTART_TEST_PASS` and `RESULT: PASS (A13 + A14)`.

## Full app-level procedure (after M1 + M2 land)

### Restart during a Gmail task (needs M3)

1. `[agent]` Request: *"Read the invoice thread and prepare a reply."* Wait for the draft to exist (step `gmail_create_draft` done).
2. Kill the agent sidecar process mid-task (Task Manager or `Stop-Process`). Optionally kill Pengu entirely and "shut down the laptop" (log out/in).
3. Relaunch Pengu (`scripts/dev.ps1`), open the workspace.
4. `[ui]` **Expected:** Pending tab lists the task with completed/pending steps and pause reason; pet shows `paused`/`awaiting` state. (`A13`)
5. `[ui]` Click **Continue** on the task.
6. **Expected resume behaviour (contract 7.6):**
   - completed steps are NOT repeated (no second draft; `gmail_send_draft` never re-runs silently);
   - server/scope checks re-run; any not-yet-executed CONSEQUENTIAL step (e.g. `gmail_send_draft`) requires a **fresh** approval — old approvals are never carried across restart;
   - begun-but-not-completed side effects: folder → verified locally; draft → M3 verifier; URL/app launches → `unknown` → **Pengu asks the user**, never blindly retries (**A14**).
7. **Evidence:** before/after screenshots of Pending tab, store dump (`receipts`, `side_effects` rows), agent log.

### Duplicate-safety spot check

1. Repeat the restart test twice in a row in the same DB (run `scripts/restart-test.ps1` again) — each run uses a fresh temp DB, so also manually re-run Phase B against the previous DB:
   ```powershell
   node scripts/restart-harness.mjs --phase B --db <old db> --sandbox <old sandbox>
   ```
2. **Expected:** `foldersNamedReports: 1`, `receipts: 1` — reconciling twice is a no-op (idempotent).

## Pass criteria

- [ ] A13: unfinished task reappears with correct state after forced kill + relaunch.
- [ ] A14: no duplicated folder/draft/send; verified side effects trusted; unknown ones surfaced as questions.
- [ ] Fresh approval required for any unexecuted consequential step after restart.
- [ ] Evidence pasted into `docs/INTEGRATION.md` (script output + screenshots + commit hash).
