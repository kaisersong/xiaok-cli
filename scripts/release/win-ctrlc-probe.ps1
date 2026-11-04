# Release smoke (1.6.2+): real Ctrl+C on `yzjchannel serve` with an in-flight write.
# Run from a built checkout on Windows (npm ci && npm run build), e.g. over `ssh yzjw`:
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\release\win-ctrlc-probe.ps1
# Pass: exit code 0 within 15s, serve.pid only under the temp HOME and removed on exit,
# and the probe row (session yzj-dry-run-probe) is readable from memory.db afterwards.
# Console is GBK on yzjw, so all probe content is ASCII.
param([string]$Repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path, [int]$TimeoutSec = 15)
$ErrorActionPreference = 'Stop'
$tmp = Join-Path ([IO.Path]::GetTempPath()) ("xiaok-ctrlc-" + [Guid]::NewGuid().ToString('N').Substring(0, 8))
$failures = New-Object System.Collections.Generic.List[string]
$realPid = Join-Path $env:USERPROFILE '.xiaok\state\yzj\serve.pid'
$realPidBefore = Test-Path $realPid
$saved = @{ HOME = $env:HOME; USERPROFILE = $env:USERPROFILE; TEMP = $env:TEMP; TMP = $env:TMP; XIAOK_CONFIG_DIR = $env:XIAOK_CONFIG_DIR }
$probeProc = $null
$probeStart = $null
$log = $null
try {
  $home2 = Join-Path $tmp 'home'; $tmp2 = Join-Path $tmp 'tmp'; $cfg = Join-Path $tmp 'config'
  New-Item -ItemType Directory -Force -Path $home2, $tmp2, $cfg | Out-Null
  $csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
  if (-not (Test-Path $csc)) { $csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe' }
  $exe = Join-Path $tmp 'win-ctrlc-probe.exe'
  & $csc /nologo /optimize "/out:$exe" (Join-Path $PSScriptRoot 'win-ctrlc-probe.cs') | Out-Host
  if ($LASTEXITCODE -ne 0) { throw "csc failed ($LASTEXITCODE)" }

  $env:HOME = $home2; $env:USERPROFILE = $home2; $env:TEMP = $tmp2; $env:TMP = $tmp2; $env:XIAOK_CONFIG_DIR = $cfg
  $probeText = 'ctrlc-probe-' + [Guid]::NewGuid().ToString('N').Substring(0, 12)
  $env:XIAOK_YZJ_DRY_RUN_PROBE_WRITE = $probeText
  $log = Join-Path $tmp 'serve.log'
  $node = (Get-Command node).Source
  $index = Join-Path $Repo 'dist\index.js'
  $argList = @('--log', "`"$log`"", '--timeout', "$TimeoutSec", '--', "`"$node`"", "`"$index`"", 'yzjchannel', 'serve',
    '--webhook-url', 'https://example.invalid/hook', '--inbound-mode', 'webhook', '--webhook-port', '0', '--dry-run')
  $out = Join-Path $tmp 'probe.out'
  $probeStart = [DateTime]::Now
  $probeProc = Start-Process -FilePath $exe -ArgumentList $argList -PassThru -NoNewWindow -RedirectStandardOutput $out
  $null = $probeProc.Handle  # cache handle so ExitCode is readable after exit (PS 5.1)

  # While serving: serve.pid must exist under the temp HOME only.
  $tmpPid = Join-Path $home2 '.xiaok\state\yzj\serve.pid'
  $deadline = (Get-Date).AddSeconds(60)
  while (-not (Test-Path $tmpPid) -and -not $probeProc.HasExited -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 100 }
  if (Test-Path $tmpPid) { Write-Host "CHECK serve.pid present in temp HOME: $tmpPid" } else { $failures.Add('serve.pid never appeared in temp HOME') }
  if ((Test-Path $realPid) -ne $realPidBefore) { $failures.Add("real serve.pid changed: $realPid") }

  if (-not $probeProc.WaitForExit(($TimeoutSec + 75) * 1000)) {
    $failures.Add('probe helper hung')
    try { & taskkill.exe /T /F /PID $probeProc.Id 2>$null | Out-Null } catch { Write-Host "WARN taskkill helper failed: $_" }
  }
  if (-not $probeProc.WaitForExit(10000)) { $failures.Add('probe helper still running after kill') }
  if ($probeProc.HasExited) {
    $helperCode = $probeProc.ExitCode
    Write-Host "CHECK helper exit code=$helperCode"
    if ($helperCode -ne 0) { $failures.Add("helper exit code=$helperCode") }
  } else { Write-Host 'WARN helper exit code unavailable (still running)' }
  $logText = if (Test-Path $log) { Get-Content $log -Raw } else { '' }
  Write-Host '--- serve.log ---'; Write-Host $logText; Write-Host '-----------------'
  $result = ($logText -split "`r?`n") | Where-Object { $_ -like 'RESULT *' } | Select-Object -Last 1
  if ($result -match 'RESULT child exited code=(-?\d+) elapsedAfterCtrlC_ms=(\d+)') {
    if ([int]$Matches[1] -ne 0) { $failures.Add("exit code $($Matches[1]) != 0") }
    if ([int]$Matches[2] -gt $TimeoutSec * 1000) { $failures.Add("exit took $($Matches[2])ms") }
  } else { $failures.Add("no exit result: $result") }
  if (Test-Path $tmpPid) { $failures.Add('serve.pid not removed after exit') } else { Write-Host 'CHECK serve.pid removed after exit' }

  # Reopen memory.db with node + better-sqlite3 from the repo and look for the probe row.
  $db = Join-Path $cfg 'memory.db'
  $js = "const D=require(process.argv[1]);const d=new D(process.argv[2],{readonly:true});" +
    "const r=d.prepare('select count(*) n from memory_l0_raw where session_id=? and content=?').get('yzj-dry-run-probe',process.argv[3]);" +
    "console.log('ROWS '+r.n);d.close();process.exit(r.n>0?0:1)"
  & $node -e $js (Join-Path $Repo 'node_modules\better-sqlite3') $db $probeText | Out-Host
  if ($LASTEXITCODE -ne 0) { $failures.Add('probe row not found in memory.db') } else { Write-Host 'CHECK probe row present in memory.db' }
} catch {
  $failures.Add("error: $_")
} finally {
  # Kill the whole tree: helper first (/T covers node), then the node child by its logged pid in case it was orphaned.
  if ($probeProc -and -not $probeProc.HasExited) {
    try { & taskkill.exe /T /F /PID $probeProc.Id 2>$null | Out-Null } catch { Write-Host "WARN taskkill helper failed: $_" }
  }
  $childPid = $null
  if ($log -and (Test-Path $log)) {
    $m = Select-String -Path $log -Pattern '^CHILD pid=(\d+)\s*$' -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($m) { $childPid = [int]$m.Matches[0].Groups[1].Value } else { Write-Host 'WARN could not parse CHILD pid from serve.log; orphan check skipped' }
  }
  if ($childPid) {
    # Only kill if it is still our node child: same pid, named node, started after the probe (guards PID reuse).
    $cp = Get-Process -Id $childPid -ErrorAction SilentlyContinue
    if ($cp) {
      $cpStart = $null
      try { $cpStart = $cp.StartTime } catch { $cpStart = $null }
      if ($cp.ProcessName -eq 'node' -and $cpStart -and $probeStart -and $cpStart -ge $probeStart) {
        try { & taskkill.exe /T /F /PID $childPid 2>$null | Out-Null } catch { Write-Host "WARN taskkill child failed: $_" }
      } else {
        Write-Host "WARN pid $childPid is not our node child (name=$($cp.ProcessName) start=$cpStart); not killed"
      }
    }
  }
  foreach ($k in $saved.Keys) { Set-Item "env:$k" $saved[$k] }
  Remove-Item Env:XIAOK_YZJ_DRY_RUN_PROBE_WRITE -ErrorAction SilentlyContinue
  Start-Sleep -Milliseconds 300
  if ($failures.Count -gt 0 -and (Test-Path $tmp)) {
    # Keep evidence outside the temp dir before deleting it.
    $keep = Join-Path ([IO.Path]::GetTempPath()) ('win-ctrlc-probe-fail-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff') + '-' + [Guid]::NewGuid().ToString('N').Substring(0, 4))
    $copyOk = $true
    try { New-Item -ItemType Directory -Force -Path $keep -ErrorAction Stop | Out-Null } catch { $copyOk = $false }
    foreach ($f in @('serve.log', 'probe.out')) {
      $src = Join-Path $tmp $f
      if ($copyOk -and (Test-Path $src)) {
        try { Copy-Item -Force $src $keep -ErrorAction Stop } catch { $copyOk = $false }
        if (-not (Test-Path (Join-Path $keep $f))) { $copyOk = $false }
      }
    }
    if ($copyOk) {
      Write-Host "FAIL artifacts kept in: $keep"
      Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
    } else {
      Write-Host "FAIL artifact copy failed; original temp dir left in place: $tmp"
    }
  } else {
    Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
  }
}
if ($failures.Count -eq 0) { Write-Host 'PASS win-ctrlc-probe'; exit 0 }
$failures | ForEach-Object { Write-Host "FAIL $_" }
exit 1
