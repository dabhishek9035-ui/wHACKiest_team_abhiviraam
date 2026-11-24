# M3 manual setup and verification

## Local prerequisites

- Node.js 20 or newer, npm, Windows 10/11 PowerShell (token is protected using current-user DPAPI).
- Google Cloud project with Gmail API enabled; Desktop OAuth client and a test user.
- Sarvam API key with Saaras and Bulbul access.
- A random `PENGU_APPROVAL_SECRET` at least 32 characters, coordinated securely with M1.

In PowerShell, set the values for the current session. `Read-Host` avoids putting the secret values in the command itself:

```powershell
function Set-SecretEnv($name, $prompt) {
  $secure = Read-Host $prompt -AsSecureString
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { [Environment]::SetEnvironmentVariable($name, [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr), 'Process') }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}
$env:GOOGLE_CLIENT_ID = Read-Host 'Google OAuth client ID'
Set-SecretEnv 'GOOGLE_CLIENT_SECRET' 'Google OAuth client secret'
Set-SecretEnv 'SARVAM_API_KEY' 'Sarvam API key'
$env:PENGU_APPROVAL_SECRET = [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
Write-Host 'Share the generated PENGU_APPROVAL_SECRET with M1 using your team credential manager; do not paste it in chat.'
npm install
npm run build:m3
npm run gmail:auth
```

Then start MCP via stdio from M1. Voice live smoke requires an audio file under 30 seconds:

```powershell
npm run voice:smoke -- en-IN .\work\sample.wav
npm run voice:smoke -- hi-IN .\work\sample-hi.wav
```

Do not use a real recipient for first send validation. Use a controlled test inbox, inspect the exact preview, and approve only the exact intended send. If interrupted and verification is `unknown`, stop and manually inspect Gmail Sent before retrying.

## Current official API facts checked for this implementation

- Saaras v4 is `saaras:v4`; real-time REST is up to 30 seconds and supports 23 languages. [Sarvam Saaras docs](https://docs.sarvam.ai/api/api-guides-tutorials/models/saaras)
- Bulbul v3/v4 Flash support 11 languages; v4 Flash uses persona IDs. This implementation currently selects Bulbul v3 for its shared named-speaker request contract. [Sarvam Bulbul docs](https://docs.sarvam.ai/api/api-guides-tutorials/models/bulbul)
- Gmail scope selection advises the narrowest scopes; `gmail.readonly` and `gmail.compose` are restricted, compose permits draft management and send. [Google Gmail scope reference](https://developers.google.com/workspace/gmail/api/auth/scopes)
- Google OAuth desktop apps use installed-app OAuth flow and loopback redirect. [Google OAuth desktop apps](https://developers.google.com/identity/protocols/oauth2/native-app)
