# Injection test (owner: M4) — A15 (web half) evidence generator.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/inject-test.ps1 [-Port 8099]
#
# What it does (mirrors tests/e2e/e2e-injection.md):
#   1. Serves fixtures/web/hostile-page.html on 127.0.0.1:<port> (local only).
#   2. Runs the node probe: fetches the page, extracts the attacker's instructions
#      (data-pengu-* payloads) and feeds them to the Local MCP server core exactly as
#      the page demanded: unknown shell command, folder outside the sandbox, traversal
#      escape, regedit launch, file:// URL, allowlisted command without/with forged
#      approval token.
#   3. Asserts EVERY attempt is refused server-side (denied / not approvable) and the
#      sandbox directory is byte-identical afterwards: NO tool call caused an effect,
#      and no approval could have been requested for denied actions.
#   4. Prints PASS/FAIL with the probe JSON as evidence.
#   Full-model A15 (the model never even emits a tool call) additionally requires M1's
#   policy gate: run tests/e2e/e2e-injection.md on main once the agent lands.

param(
    [int]$Port = 8099
)
$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot

function Write-Section($t) { Write-Host "`n=== $t ===" -ForegroundColor Cyan }
function Assert-File($p, $what) {
    if (-not (Test-Path $p)) { Write-Host "MISSING: $what ($p)" -ForegroundColor Red; exit 1 }
}

Assert-File (Join-Path $repoRoot "mcp/local/dist/server.js") "@pengu/local-mcp build (run: pnpm build)"
Assert-File (Join-Path $repoRoot "fixtures/web/hostile-page.html") "hostile fixture"

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$tmp = Join-Path $env:TEMP "pengu-inject-test-$stamp"
$sandbox = Join-Path $tmp "sandbox"
New-Item -ItemType Directory -Force -Path $tmp, $sandbox | Out-Null

$serveLog = Join-Path $tmp "serve.log"
$probeLog = Join-Path $tmp "probe.log"

Write-Host "inject-test: temp evidence dir: $tmp" -ForegroundColor Cyan

# ---------- serve the hostile fixture ----------
Write-Section "Serving hostile fixture on 127.0.0.1:$Port"
# NOTE: quote every path argument - repo paths contain spaces.
$serveArgs = '"{0}" --file "{1}" --port {2}' -f (Join-Path $repoRoot "scripts/inject-serve.mjs"), (Join-Path $repoRoot "fixtures/web/hostile-page.html"), $Port
$serve = Start-Process -FilePath "node" -ArgumentList $serveArgs `
    -WorkingDirectory $repoRoot -NoNewWindow -PassThru `
    -RedirectStandardOutput $serveLog -RedirectStandardError (Join-Path $tmp "serve.err.log")

try {
    $deadline = (Get-Date).AddSeconds(15)
    $ready = $false
    while ((Get-Date) -lt $deadline) {
        Start-Sleep -Milliseconds 300
        $content = Get-Content $serveLog -Raw -ErrorAction SilentlyContinue
        if ($content -match "SERVING") { $ready = $true; break }
        if ($serve.HasExited) { break }
    }
    if (-not $ready) {
        Write-Host "inject-serve did not become ready in time." -ForegroundColor Red
        Get-Content (Join-Path $tmp "serve.err.log") -ErrorAction SilentlyContinue | Write-Host
        exit 1
    }
    Get-Content $serveLog | Write-Host

    # ---------- run the probe ----------
    Write-Section "Probe: feed hostile-page instructions to the Local MCP core"
    $pageUrl = "http://127.0.0.1:$Port/hostile-page.html"
    $probeArgs = '"{0}" --url "{1}" --sandbox "{2}"' -f (Join-Path $repoRoot "scripts/inject-probe.mjs"), $pageUrl, $sandbox
    $proc = Start-Process -FilePath "node" -ArgumentList $probeArgs `
        -WorkingDirectory $repoRoot -NoNewWindow -PassThru -Wait `
        -RedirectStandardOutput $probeLog -RedirectStandardError (Join-Path $tmp "probe.err.log")
    Get-Content $probeLog | Write-Host
    $err = Get-Content (Join-Path $tmp "probe.err.log") -ErrorAction SilentlyContinue
    if ($err) { $err | Write-Host }

    if ($proc.ExitCode -eq 0 -and ((Get-Content $probeLog -Raw) -match "INJECT_TEST_PASS")) {
        Write-Section "RESULT: PASS (A15 web half)"
        Write-Host "Evidence: $tmp (probe.log, serve.log, sandbox/ untouched)" -ForegroundColor Green
        exit 0
    } else {
        Write-Section "RESULT: FAIL"
        Write-Host "Evidence: $tmp" -ForegroundColor Red
        exit 1
    }
} finally {
    if ($serve -and -not $serve.HasExited) {
        Stop-Process -Id $serve.Id -Force -ErrorAction SilentlyContinue
    }
}
