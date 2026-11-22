# E2E: Local actions — folder / URL / app (owner: M4)

**Acceptance IDs:** A10 (open Chrome, open a URL, launch an allowlisted app), A11 (create folder in approved dir without a prompt), A12 (history records operation and result). Partial server halves verified automatically by `mcp/local/test/local-server.test.ts` (24 tests) and `scripts/inject-test.ps1`.

**Status:** tool-level halves are green today (2026-11-22). Steps marked `[agent]` need M1's runtime + M2's UI on `main` and must be executed once before the G4 gate.

## Preconditions

1. `pnpm install` and `pnpm build` from a clean clone succeed.
2. `PENGU_APPROVAL_SECRET` set in the environment (any dev value; never committed).
3. `%USERPROFILE%\Documents\PenguSandbox` exists (created automatically by the local server at startup since it is a granted root in `mcp/local/config/local-scopes.json`).
4. Chrome installed (default paths) or `chromePath` set in `local-scopes.json`.
5. For `[agent]` steps: agent running via `scripts/dev.ps1`, Pengu workspace open.

## Procedure

### 1. Folder creation inside the approved root — no approval prompt (A11)

1. `[agent]` Type: *"Create a folder called invoices in my PenguSandbox."*
2. Watch the activity timeline: one `fs_create_folder` step (ROUTINE), **no approval modal**.
3. `[tool-level]` Equivalent server-core check:
   ```powershell
   pnpm --filter @pengu/local-mcp test
   # expect: 24 passed (fs_create_folder scoping suite)
   ```
4. **Expected:** folder `%USERPROFILE%\Documents\PenguSandbox\invoices` exists; timeline shows `done`.
5. **Evidence to paste:** screenshot of timeline + `Get-ChildItem $env:USERPROFILE\Documents\PenguSandbox` output.

### 2. Folder creation outside the root — denied without prompt

1. `[agent]` Type: *"Create a folder called pwned in C:\Windows\Temp."*
2. **Expected:** refused with `path_outside_scope`; **not approvable** (no approval modal is even offered — denial happens in the local server and/or policy gate).
3. `[tool-level]` covered by `mcp/local/test/local-server.test.ts` (denies absolute paths outside the approved root).

### 3. Open Chrome + URL (A10)

1. `[agent]` Type: *"Open example.com in Chrome."*
2. **Expected:** Chrome launches with `https://example.com`; timeline shows `browser_open_url` `done`; the step is honestly marked *not locally verifiable* in the result note.
3. `[tool-level]` Scheme enforcement: unit tests prove `file:`/`javascript:`/`ftp:` and credential URLs are refused (`scheme_not_allowed`, `url_credentials_not_allowed`).

### 4. Launch an allowlisted app (A10)

1. `[agent]` Type: *"Open Notepad."*
2. **Expected:** Notepad opens (`appId: notepad` from `local-scopes.json`); timeline `done`.
3. `[tool-level]` Unknown app IDs (`regedit` etc.) are refused with `app_not_allowed` — covered by unit tests and `scripts/inject-test.ps1`.

### 5. History records each operation (A12)

1. `[agent]` After steps 1–4, open the History tab.
2. **Expected:** every operation listed with tool, server, result and timestamp from the store (`listReceipts` / task history). No fabricated "Completed" states: URL/app launches show launch-observed, folder creation shows verified.

## Pass criteria

- [ ] A11 prompt-free inside root; denial outside root.
- [ ] A10 all three local actions demonstrably ran (screenshots).
- [ ] A12 history matches the store; honest result wording.
- [ ] Evidence pasted into `docs/INTEGRATION.md` by the runner.
