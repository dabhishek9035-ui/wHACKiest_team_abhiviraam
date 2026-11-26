import { OAuth2Client } from 'google-auth-library';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { URL } from 'node:url';

const TOKEN_DIR = join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'Pengu');
const TOKEN_FILE = join(TOKEN_DIR, 'gmail-token.dpapi');
export const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.compose'
];
function credentials() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET from a Google OAuth Desktop app');
  return { clientId, clientSecret };
}
export async function getOAuthClient(): Promise<OAuth2Client> {
  const { clientId, clientSecret } = credentials();
  const client = new OAuth2Client(clientId, clientSecret);
  const stored = await readProtectedToken();
  if (!stored) throw new Error('Gmail is not connected or its saved sign-in is invalid. Select Connect Gmail and sign in again.');
  client.setCredentials(JSON.parse(stored));
  client.on('tokens', async tokens => {
    const current = client.credentials;
    await writeProtectedToken(JSON.stringify({ ...current, ...tokens }));
  });
  return client;
}
export async function connectGmail(): Promise<void> {
  const { clientId, clientSecret } = credentials();
  const state = randomBytes(24).toString('hex');
  const server = createServer();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Could not start OAuth loopback callback');
  const redirectUri = `http://127.0.0.1:${address.port}/oauth2callback`;
  const client = new OAuth2Client(clientId, clientSecret, redirectUri);
  const authUrl = client.generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: GMAIL_SCOPES, state });
  console.log(`Open this URL to authorize the Gmail scopes:\n${authUrl}\n`);
  const open = await import('node:child_process');
  const opener = process.platform === 'win32' ? 'rundll32' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', authUrl] : [authUrl];
  open.spawn(opener, args, { stdio: 'ignore', detached: true }).unref();
  const authCode = await new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('OAuth timed out after 5 minutes')), 300_000);
    server.on('request', async (req, res) => {
      try {
        const url = new URL(req.url ?? '/', redirectUri);
        if (url.pathname !== '/oauth2callback') { res.writeHead(404).end(); return; }
        if (url.searchParams.get('state') !== state) throw new Error('OAuth state mismatch');
        const code = url.searchParams.get('code');
        if (!code) {
          const oauthError = url.searchParams.get('error');
          if (oauthError === 'access_denied') {
            throw new Error('Google denied access. If this OAuth app is in Testing, add this Google account under Google Cloud Console → Google Auth Platform → Audience → Test users. A Workspace administrator can also block access.');
          }
          throw new Error('Google did not return an authorization code.');
        }
        res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }).end('Gmail connected. You can close this tab.');
        clearTimeout(timeout); resolve(code);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Authorization failed.';
        res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' }).end(message);
        clearTimeout(timeout);
        reject(error);
      }
    });
  }).finally(() => server.close());
  const { tokens } = await client.getToken(authCode);
  await writeProtectedToken(JSON.stringify(tokens));
  console.log('Gmail OAuth credentials saved in a Windows DPAPI-protected file outside the repository.');
}
export async function disconnectGmail(): Promise<void> { await rm(TOKEN_FILE, { force: true }); }

export async function isGmailConnected(): Promise<boolean> {
  const stored = await readProtectedToken();
  if (!stored) return false;
  try {
    const tokens = JSON.parse(stored) as Record<string, unknown>;
    return typeof tokens.access_token === 'string' || typeof tokens.refresh_token === 'string';
  } catch {
    return false;
  }
}

async function powershell(script: string, stdin?: string): Promise<string> {
  if (process.platform !== 'win32') throw new Error('This M3 credential store currently targets Windows 10/11.');
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, env: { ...process.env, PENGU_GMAIL_TOKEN_FILE: TOKEN_FILE } });
    let stdout = '', stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => stdout += chunk);
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => stderr += chunk);
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(stdout.trim()) : reject(new Error(`Windows DPAPI credential operation failed (${code}): ${stderr.slice(0, 300)}`)));
    if (stdin !== undefined) { child.stdin.end(stdin, 'utf8'); }
  });
}
async function writeProtectedToken(tokenJson: string) {
  await mkdir(TOKEN_DIR, { recursive: true });
  const script = "$ErrorActionPreference = 'Stop'; try { $secret = [Console]::In.ReadToEnd(); if ([string]::IsNullOrWhiteSpace($secret)) { throw 'No Gmail credentials were received.' }; Add-Type -AssemblyName System.Security | Out-Null; $bytes = [System.Text.Encoding]::UTF8.GetBytes($secret); $encrypted = [System.Security.Cryptography.ProtectedData]::Protect($bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser); [System.IO.File]::WriteAllBytes($env:PENGU_GMAIL_TOKEN_FILE, $encrypted) } catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }";
  await powershell(script, tokenJson);
  if (await readProtectedToken() !== tokenJson) {
    throw new Error('Windows could not verify the saved Gmail credentials. Select Connect Gmail and sign in again.');
  }
}
async function readProtectedToken(): Promise<string | undefined> {
  try {
    const file = await readFile(TOKEN_FILE);
    if (file.byteLength < 16) return undefined;
  } catch {
    return undefined;
  }
  const script = "$ErrorActionPreference = 'Stop'; try { Add-Type -AssemblyName System.Security | Out-Null; $encrypted = [System.IO.File]::ReadAllBytes($env:PENGU_GMAIL_TOKEN_FILE); $plain = [System.Security.Cryptography.ProtectedData]::Unprotect($encrypted, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([System.Text.Encoding]::UTF8.GetString($plain)) } catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }";
  try {
    return await powershell(script);
  } catch {
    return undefined;
  }
}
