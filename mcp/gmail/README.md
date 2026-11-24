# M3 Gmail MCP

Real Gmail MCP stdio server, desktop OAuth connection, Gmail search/read/reply-draft/get/send tools, and a separately verified approval token on send. OAuth tokens are protected with Windows DPAPI for the current user in `%LOCALAPPDATA%\Pengu`, outside the repository. `PENGU_GMAIL_STUB=1` is a clearly labeled development stub and cannot send or claim live data.

## Setup

1. Install Node 20+ and npm. From repository root run `npm install`.
2. In Google Cloud Console create a project, enable Gmail API, configure OAuth consent in Testing, add the intended test account under Test users, and create OAuth Client ID type Desktop app. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in the local process environment (this package does not load `.env` files).
3. Grant only `gmail.readonly`, `gmail.compose`, and `gmail.send` scopes. These are restricted/sensitive permissions and Google may show an unverified app warning while testing. Do not use production mail for the first send test.
4. Set `PENGU_APPROVAL_SECRET` to at least 32 random characters, then `npm run gmail:auth`. Google opens a local loopback consent flow; the resulting token is encrypted with Windows DPAPI for the current user.
5. Run `npm run gmail:mcp` as the M1 stdio child process. Logs/protocol use stdout only for MCP; do not write diagnostics to stdout.

## Authorization contract

M1 previews with `gmail_get_draft`, hashes canonical `{draftId, contentHash}`, and signs `{approvalId, tool, argsHash, expiresAt}` using the shared HMAC key. The invocation bridge injects `_authorization` into the MCP call after approval and must omit that property from the model-visible tool schema. This server independently checks token signature, expiry, tool, args hash, and current draft content before calling `drafts.send`. Never retry on an indeterminate result; call `verifyDraftSent` and ask the user if it remains unknown.

This workspace did not include M1's bridge/contracts or Google/Sarvam credentials, so a real account/API end-to-end run requires those external setup items. The code is wired for real APIs and fails closed without them.
