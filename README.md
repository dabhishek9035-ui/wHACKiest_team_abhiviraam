# Pengu

Pengu is a Windows desktop companion with a React/Tauri interface and a local Node agent. The agent connects to Sarvam for chat and speech, and starts Gmail and local tools as MCP stdio children. The policy gate checks permissions and requires exact-action approval for consequential operations such as sending a Gmail draft.

## Requirements

- Windows 10 or 11 and PowerShell.
- Node.js 20 or newer (the workspace engine minimum is Node 18.18).
- pnpm 9.12.x, as declared by `packageManager` in the root `package.json`.
- Rust stable using the MSVC toolchain, Microsoft C++ Build Tools with **Desktop development with C++**, and Microsoft Edge WebView2 for the Tauri desktop app. See the [Tauri Windows prerequisites](https://v2.tauri.app/start/prerequisites/).
- Chrome for the local MCP browser URL action.

On Windows, use `pnpm.cmd` in PowerShell if script execution policy blocks `pnpm.ps1`.

## Install and configure

Run these commands from the repository root (`pengu`):

```powershell
pnpm.cmd install
Copy-Item .env.example .env
```

Edit `.env` locally. Never commit it or paste its values into chat.

| Variable | Purpose |
|---|---|
| `SARVAM_API_KEY` | Sarvam GLM chat and Saaras/Bulbul voice services. |
| `PENGU_APPROVAL_SECRET` | Shared HMAC secret for exact-action approval tokens; use at least 32 random characters. |
| `PENGU_WS_TOKEN` | Shared agent/UI authentication token; use at least 16 characters and keep the same value for both processes. |
| `GOOGLE_CLIENT_ID` | Google OAuth Desktop client ID for Gmail. |
| `GOOGLE_CLIENT_SECRET` | Google OAuth Desktop client secret. |
| `PENGU_LOG_LEVEL` | Optional log level: `error`, `warn`, `info`, or `debug`. |
| `PENGU_LOCAL_MCP_CONFIG` | Optional override for the local MCP config directory. |

The app does not automatically import `.env`. Load it into each PowerShell terminal that starts Pengu. This helper supports simple `KEY=value` lines and matching single or double quotes:

```powershell
function Import-PenguEnv {
  foreach ($line in Get-Content .env) {
    if ($line -match '^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$') {
      $key = $Matches[1]
      $value = $Matches[2].Trim()
      if ($value.Length -ge 2 -and (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'")))) {
        $value = $value.Substring(1, $value.Length - 2)
      }
      [Environment]::SetEnvironmentVariable($key, $value, 'Process')
    }
  }
}
Import-PenguEnv
```

## Connect Gmail

1. In Google Cloud Console, enable the Gmail API and create an OAuth client with application type **Desktop app**.
2. In **Google Auth Platform > Audience**, leave the app in Testing for development and add the exact Google account you plan to use under **Test users**. The app in Testing only accepts listed testers. See [Google's app audience guide](https://support.google.com/cloud/answer/15549945) and [403 access_denied guidance](https://support.google.com/accounts/answer/16668185).
3. Put the client ID and secret in `.env`, then load `.env` in the agent terminal.
4. Start Pengu and choose **Connect Gmail** in the Quick request panel or Workspace. Sign in with the listed test account and approve the requested Gmail access.

The current OAuth request uses Gmail read-only and compose scopes. If Google displays `403 access_denied`, verify that the OAuth client ID belongs to the project whose Test users list you edited, and that the browser is signed into the listed account. A Google Workspace administrator can also block an app. The OAuth token is protected with Windows DPAPI and stored outside the repository at `%LOCALAPPDATA%\Pengu\gmail-token.dpapi`.

## Build and run the full app

Build the workspace once after install or after changing agent/contracts/Gmail code:

```powershell
pnpm.cmd build
```

### Terminal 1: agent and MCP services

From the repository root, load `.env` with the helper above, then run:

```powershell
pnpm.cmd --filter @pengu/agent start
```

The agent listens on `ws://127.0.0.1:7777`. It starts the Gmail and local MCP servers over stdio; those child servers do not open network ports. Keep this terminal running.

### Terminal 2: desktop chat and pet

Open another PowerShell terminal at the repository root, define and run the same `Import-PenguEnv` helper, then:

```powershell
Set-Location apps/desktop
cargo tauri dev
```

Tauri starts the Vite dev server on `http://127.0.0.1:1420` and opens the Pengu desktop window. The Tauri process needs the same `PENGU_WS_TOKEN` as the agent. Double-click the pet to open Workspace; a single click opens Quick request.

Stop the app cleanly with `Ctrl+C` in both terminals. This stops the Tauri/Vite UI, the agent, its MCP children, and an in-progress Gmail OAuth helper.

### Other run modes

- `pnpm.cmd dev` runs `scripts/dev.ps1`; it builds the workspaces and starts the agent only. Start Tauri separately using Terminal 2 above.
- Agent source mode: after loading `.env`, run `pnpm.cmd --filter @pengu/agent dev` instead of `start`.
- Browser UI mock: from `apps/desktop`, run `npm.cmd run dev`, then open `http://127.0.0.1:1420/?mock=1`. The browser mock does not connect to the authenticated agent.

## Development commands

```powershell
pnpm.cmd build
pnpm.cmd typecheck
pnpm.cmd test
pnpm.cmd --filter @pengu/agent test
pnpm.cmd --filter @pengu/gmail-mcp test
pnpm.cmd --filter @pengu/local-mcp test
```

`pnpm.cmd build` builds workspace packages. `pnpm.cmd typecheck` runs available TypeScript checks; `pnpm.cmd test` runs available package tests. The focused package commands are useful while changing one service.

## Project structure

| Path | Purpose |
|---|---|
| `apps/desktop` | Tauri + React pet, Quick request, Workspace, history, approvals, and Gmail connection control. |
| `services/agent` | Authenticated WebSocket server, Sarvam GLM runtime, policy gate, approvals, and MCP registry. |
| `mcp/gmail` | Gmail search/read/draft/send tools and desktop OAuth flow. Sending requires exact-action approval. |
| `mcp/local` | Scoped filesystem, browser, allowlisted app, and restricted shell tools. Config is under `mcp/local/config`. |
| `packages/contracts` | WebSocket events, tool, approval, store, and voice contracts. |
| `packages/store` | SQLite store implementation and in-memory twin. |
| `docs` | Architecture, contracts, integration plan, setup, and demo guide. |

## Security and service behavior

- The UI connects only to the loopback WebSocket agent. The agent validates the shared token and keeps API keys server-side.
- Sarvam processes chat and speech requests in the cloud. Gmail access uses Google OAuth; tokens stay outside the repository and are DPAPI-protected for the current Windows user.
- Email and web content are treated as untrusted. Gmail sending requires an exact preview and approval token; a model request alone cannot send mail.
- Local MCP permissions are configured in `mcp/local/config/local-scopes.json` and `command-allowlist.json`. Review those files before changing filesystem roots or allowed commands.
- The standalone agent currently uses its in-memory store fallback unless a store is injected. Its task history is cleared when the agent exits.

## Troubleshooting

- **Google `403 access_denied`:** add the signed-in account to the Test users list for the Google Cloud project matching the client ID in the error page. Then retry **Connect Gmail**.
- **Chat shows `fetch failed`:** check outbound HTTPS access from the agent process and confirm `SARVAM_API_KEY` is loaded in that terminal.
- **UI says offline or cannot authenticate:** confirm the agent is listening on port 7777 and both terminals loaded the same `PENGU_WS_TOKEN`.
- **Port already in use:** stop the previous agent/Tauri dev session before starting another one.
- **Voice upload rejected:** the agent strips MediaRecorder codec parameters and sends the base MIME type (for example, `audio/webm`).

For architecture and event details, see `docs/STRUCTURE.md`, `docs/CONTRACTS.md`, and `docs/INTEGRATION.md`.
