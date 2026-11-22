# Restart-safety test (owner: M4) — A13/A14 evidence generator.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/restart-test.ps1
#
# What it does (mirrors tests/e2e/e2e-restart.md):
#   1. Builds the workspace if needed (store + local MCP dist must exist).
#   2. Phase A: starts a node harness that creates a task, persists the folder-creation
#      intent (beginSideEffect), performs the creation via the Local MCP core, saves a
#      checkpoint, then idles "mid-task". The script waits for PHASE_A_DONE, then
#      force-kills the process (Stop-Process -Force) exactly like an app crash.
#   3. Phase B: relaunches a fresh harness process on the same SQLite store and asserts:
#        - the unfinished task reappears as pending with correct step states (A13)
#        - the begun-but-not-completed side effect is VERIFIED (folder exists) and
#          completed with evidence - never blindly repeated (A14)
#        - exactly ONE "reports" folder exists (no duplicate creation)
#        - exactly ONE folder-creation receipt exists
#        - the remaining step resumes and the task finishes honestly ("completed")
#   4. Prints PASS/FAIL with evidence paths (temp dir is kept for inspection).

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot

function Write-Section($t) { Write-Host "`n=== $t ===" -ForegroundColor Cyan }

function Assert-File($p, $what) {
    if (-not (Test-Path $p)) { Write-Host "MISSING: $what ($p)" -ForegroundColor Red; exit 1 }
}

Assert-File (Join-Path $repoRoot "packages/store/dist/index.js") "@pengu/store build (run: pnpm build)"
Assert-File (Join-Path $repoRoot "mcp/local/dist/server.js") "@pengu/local-mcp build (run: pnpm build)"

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$tmp = Join-Path $env:TEMP "pengu-restart-test-$stamp"
$db = Join-Path $tmp "pengu.db"
$sandbox = Join-Path $tmp "sandbox"
New-Item -ItemType Directory -Force -Path $tmp, $sandbox | Out-Null

$harness = Join-Path $repoRoot "scripts/restart-harness.mjs"
$logA = Join-Path $tmp "phase-a.log"
$logB = Join-Path $tmp "phase-b.log"

Write-Host "restart-test: temp evidence dir: $tmp" -ForegroundColor Cyan

# ---------- Phase A: run mid-task, then force-kill ----------
Write-Section "Phase A: start task, persist intent, create folder, KILL mid-task"
# NOTE: quote every path argument - repo paths contain spaces.
$argsA = '"{0}" --phase A --db "{1}" --sandbox "{2}"' -f $harness, $db, $sandbox
$procA = Start-Process -FilePath "node" -ArgumentList $argsA `
    -WorkingDirectory $repoRoot -NoNewWindow -PassThru `
    -RedirectStandardOutput $logA -RedirectStandardError (Join-Path $tmp "phase-a.err.log")

$deadline = (Get-Date).AddSeconds(30)
$phaseADone = $false
while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 300
    if (Test-Path $logA) {
        $content = Get-Content $logA -Raw -ErrorAction SilentlyContinue
        if ($content -match "PHASE_A_DONE") { $phaseADone = $true; break }
    }
    if ($procA.HasExited) { break }
}
if (-not $phaseADone) {
    Write-Host "Phase A did not reach PHASE_A_DONE in time; killing and failing." -ForegroundColor Red
    if (-not $procA.HasExited) { Stop-Process -Id $procA.Id -Force }
    Get-Content (Join-Path $tmp "phase-a.err.log") -ErrorAction SilentlyContinue | Write-Host
    exit 1
}
Get-Content $logA | Write-Host
# The forced kill: simulates app crash / laptop shutdown mid-task.
Stop-Process -Id $procA.Id -Force
Write-Host "Phase A process killed (PID $($procA.Id)) - simulated crash mid-task." -ForegroundColor Yellow

# ---------- Phase B: relaunch and verify ----------
Write-Section "Phase B: relaunch, assert restore + no duplicates"
$argsB = '"{0}" --phase B --db "{1}" --sandbox "{2}"' -f $harness, $db, $sandbox
$procB = Start-Process -FilePath "node" -ArgumentList $argsB `
    -WorkingDirectory $repoRoot -NoNewWindow -PassThru -Wait `
    -RedirectStandardOutput $logB -RedirectStandardError (Join-Path $tmp "phase-b.err.log")
Get-Content $logB | Write-Host
$errB = Get-Content (Join-Path $tmp "phase-b.err.log") -ErrorAction SilentlyContinue
if ($errB) { $errB | Write-Host }

if ($procB.ExitCode -eq 0 -and ((Get-Content $logB -Raw) -match "RESTART_TEST_PASS")) {
    Write-Section "RESULT: PASS (A13 + A14)"
    Write-Host "Evidence: $tmp (phase-a.log, phase-b.log, pengu.db, sandbox/)" -ForegroundColor Green
    exit 0
} else {
    Write-Section "RESULT: FAIL"
    Write-Host "Evidence: $tmp" -ForegroundColor Red
    exit 1
}
