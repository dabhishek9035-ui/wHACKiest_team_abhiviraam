# Pengu dev runner (owner: M4 / D Venkata Abhishek)
# Starts the monorepo in dependency order and reports component readiness honestly.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/dev.ps1 [-LocalOnly]
#
# START ORDER (final architecture, see docs/INTEGRATION.md):
#   1. services/agent  (Node sidecar)      — WebSocket on 127.0.0.1:7777, per-launch
#                                            token in PENGU_WS_TOKEN. The agent SPAWNS
#                                            the two MCP servers over stdio itself.
#   2. mcp/gmail       (spawned by agent)  — stdio, no port
#   3. mcp/local       (spawned by agent)  — stdio, no port
#   4. apps/desktop    (Tauri)             — connects to ws://127.0.0.1:7777
#   Only the agent listens on a port; MCP servers use stdio; nothing else exposes TCP.
#
# ENVIRONMENT (names in .env.example; values NEVER echoed by this script):
#   SARVAM_API_KEY, PENGU_APPROVAL_SECRET, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET,
#   PENGU_WS_TOKEN, PENGU_LOG_LEVEL

param(
    [switch]$LocalOnly
)
$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot

function Test-Placeholder($file) {
    if (-not (Test-Path $file)) { return $true }
    $head = Get-Content $file -TotalCount 6 -ErrorAction SilentlyContinue
    return (($head -join "`n") -match "TODO: implement")
}

function Write-Section($t) { Write-Host "`n=== $t ===" -ForegroundColor Cyan }

Write-Section "Pengu dev runner (repo: $repoRoot)"

# --- prerequisites ---
Write-Section "Prerequisites"
foreach ($tool in @("node", "pnpm")) {
    $cmd = Get-Command $tool -ErrorAction SilentlyContinue
    if ($null -eq $cmd) { Write-Host "  MISSING: $tool" -ForegroundColor Red; exit 1 }
    $v = & $tool --version 2>$null
    Write-Host ("  ok: {0} {1}" -f $tool, $v)
}

# --- env check (names only, never values) ---
Write-Section "Environment variable names (values are never printed)"
$required = @("SARVAM_API_KEY", "PENGU_APPROVAL_SECRET", "PENGU_WS_TOKEN")
foreach ($name in $required) {
    $present = [bool][Environment]::GetEnvironmentVariable($name)
    if ($present) { Write-Host "  set : $name" -ForegroundColor Green }
    else { Write-Host "  MISSING: $name (see .env.example)" -ForegroundColor Yellow }
}

# --- install + build ---
Write-Section "Install and build (pnpm workspaces)"
Push-Location $repoRoot
try {
    if (-not (Test-Path "node_modules")) {
        pnpm install
        if ($LASTEXITCODE -ne 0) { throw "pnpm install failed" }
    }
    pnpm -r --if-present run build
    if ($LASTEXITCODE -ne 0) { throw "workspace build failed" }
} finally { Pop-Location }

# --- component readiness (honest, no pretending) ---
Write-Section "Component readiness"
$components = @(
    @{ Name = "packages/contracts (M1)"; Entry = "packages/contracts/src/index.ts" },
    @{ Name = "packages/store (M4)"; Entry = "packages/store/src/index.ts" },
    @{ Name = "services/agent (M1)"; Entry = "services/agent/src/main.ts" },
    @{ Name = "mcp/local (M4)"; Entry = "mcp/local/src/server.ts" },
    @{ Name = "mcp/gmail (M3)"; Entry = "mcp/gmail/src/server.ts" },
    @{ Name = "apps/desktop (M2)"; Entry = "apps/desktop/src/main.tsx" }
)
foreach ($c in $components) {
    $path = Join-Path $repoRoot $c.Entry
    if (Test-Placeholder $path) {
        Write-Host ("  placeholder : {0}" -f $c.Name) -ForegroundColor Yellow
    } else {
        Write-Host ("  implemented : {0}" -f $c.Name) -ForegroundColor Green
    }
}

# --- start what exists, in order ---
Write-Section "Start order"

if ($LocalOnly) {
    Write-Host "  -LocalOnly: starting mcp/local over stdio for manual MCP inspector testing" -ForegroundColor Cyan
    Write-Host "  (no ports are opened; the server speaks MCP over stdio; Ctrl+C to stop)"
    Write-Host "  tip: npx @modelcontextprotocol/inspector node mcp/local/dist/server.js"
    node (Join-Path $repoRoot "mcp/local/dist/server.js")
    return
}

$agentEntry = Join-Path $repoRoot "services/agent/src/main.ts"
if (-not (Test-Placeholder $agentEntry)) {
    Write-Host "  starting services/agent (WS 127.0.0.1:7777; spawns both MCP servers)..."
    Push-Location $repoRoot
    try { node (Join-Path $repoRoot "services/agent/dist/main.js") } finally { Pop-Location }
} else {
    Write-Host "  services/agent is still a scaffold placeholder (M1) - nothing to start yet." -ForegroundColor Yellow
    Write-Host "  The agent spawns the MCP servers over stdio; without it there is nothing to run."
    Write-Host "  What works TODAY (M4):"
    Write-Host "    pnpm --filter @pengu/store test          # store contract tests (A12/A13/A14 halves)"
    Write-Host "    pnpm --filter @pengu/local-mcp test      # local server policy tests (A9/A11 halves)"
    Write-Host "    scripts/restart-test.ps1                 # forced kill + relaunch, no duplicates (A13/A14)"
    Write-Host "    scripts/inject-test.ps1                  # hostile page denials (A15 web half)"
    Write-Host "    powershell -File scripts/dev.ps1 -LocalOnly   # mcp/local over stdio for MCP inspector"
}

Write-Section "Forced-restart procedure (summary)"
Write-Host "  scripts/restart-test.ps1 automates it: start harness (phase A) -> Stop-Process"
Write-Host "  -Force mid-task -> relaunch (phase B) -> assert task pending, side effect verified,"
Write-Host "  no duplicate folder/receipt. Full procedure: tests/e2e/e2e-restart.md."
Write-Host "`ndone."
