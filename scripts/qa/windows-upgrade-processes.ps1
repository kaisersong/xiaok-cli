function Observe-Owned {
  $all = @(Get-CimInstance Win32_Process)
  $selected = @{}
  foreach ($proc in $all) { if (Is-OwnedPath $proc.ExecutablePath) { $selected[[int]$proc.ProcessId] = 'owned-path' } }
  do {
    $added = $false
    foreach ($proc in $all) {
      if ($selected.ContainsKey([int]$proc.ProcessId) -or -not $selected.ContainsKey([int]$proc.ParentProcessId)) { continue }
      $parents = @($all | Where-Object { $_.ProcessId -eq $proc.ParentProcessId })
      if ($parents.Count -ne 1 -or $proc.CreationDate -lt $parents[0].CreationDate -or -not $proc.ExecutablePath) { throw 'Unknown owned descendant identity; no signal authorized' }
      $selected[[int]$proc.ProcessId] = 'observed-owned-parent'; $added = $true
    }
  } while ($added)
  foreach ($proc in $all) {
    if ($selected.ContainsKey([int]$proc.ProcessId)) {
      $key = "$($proc.ProcessId)/$($proc.CreationDate.ToUniversalTime().Ticks)"
      $owned[$key] = [ordered]@{ pid = [int]$proc.ProcessId; creationTicks = $proc.CreationDate.ToUniversalTime().Ticks;
        path = $proc.ExecutablePath; parentPID = [int]$proc.ParentProcessId; ownership = $selected[[int]$proc.ProcessId] }
    }
  }
}
function Stop-JoinOwned {
  $drainErrors = [Collections.Generic.List[string]]::new()
  try { Observe-Owned } catch { $drainErrors.Add("observe: $($_.Exception.ToString())") }
  foreach ($item in @($owned.Values)) {
    try {
      $live = @(Get-CimInstance Win32_Process -Filter "ProcessId = $($item.pid)")
      if ($live.Count -eq 0) { continue }
      if ($live.Count -ne 1 -or $live[0].CreationDate.ToUniversalTime().Ticks -ne $item.creationTicks -or
          $live[0].ExecutablePath -cne $item.path -or $item.ownership -notin @('owned-path','observed-owned-parent')) {
        throw "PID identity changed/unknown; not signalled: $($item.pid)"
      }
      try { Stop-Process -Id $item.pid -ErrorAction Stop; $forcedStops.Add($item) } catch {
        # Only a confirmed terminal race is accepted; live/unknown failures remain errors.
        if (@(Get-CimInstance Win32_Process -Filter "ProcessId = $($item.pid)").Count -ne 0) { throw }
      }
      $end = [DateTime]::UtcNow.AddSeconds(15)
      while (@(Get-CimInstance Win32_Process -Filter "ProcessId = $($item.pid)").Count -gt 0) {
        if ([DateTime]::UtcNow -ge $end) { throw "Owned PID did not terminate: $($item.pid)" }
        Start-Sleep -Milliseconds 100
      }
    } catch { $drainErrors.Add("pid $($item.pid): $($_.Exception.ToString())") }
  }
  if ($drainErrors.Count) { throw ($drainErrors -join "`n") }
}
function Run-Owned([string]$Phase, [string]$Exe, [string]$Arguments) {
  if ((Test-Path Env:GH_TOKEN) -or (Test-Path Env:GITHUB_TOKEN)) { throw 'Refusing to pass publication credentials to installed processes' }
  if (-not (Is-OwnedPath $Exe)) { throw 'Executable outside owned root' }
  Assert-NoReparse $Exe
  $start = @{ FilePath = $Exe; PassThru = $true; WorkingDirectory = $root; RedirectStandardOutput = (Join-Path $evidence "$Phase.stdout.log"); RedirectStandardError = (Join-Path $evidence "$Phase.stderr.log") }
  if ($Arguments) { $start.ArgumentList = $Arguments }
  $process = Start-Process @start
  $row = [ordered]@{ phase = $Phase; path = $Exe; argv = $Arguments; pid = $process.Id; startedUTC = [DateTime]::UtcNow.ToString('o') }
  $records.Add($row); Save-Json 'steps.json' $records
  $end = [DateTime]::UtcNow.AddSeconds(180)
  try {
    do {
      Observe-Owned
      if ($process.WaitForExit(250)) { break }
      if ([DateTime]::UtcNow -ge $end) { throw "Owned $Phase timed out" }
    } while ($true)
    $process.WaitForExit(); $row.exit = $process.ExitCode; $row.waited = $true
    if ($process.ExitCode -ne 0) { throw "$Phase exited $($process.ExitCode)" }
  } finally { Save-Json 'steps.json' $records; $process.Dispose() }
}
function Assert-InstalledVersion([string]$Expected) {
  Assert-NoReparse $installedExe
  $info = [Diagnostics.FileVersionInfo]::GetVersionInfo($installedExe)
  $actual = @($info.FileMajorPart, $info.FileMinorPart, $info.FileBuildPart) -join '.'
  if ($actual -cne $Expected) { throw "Installed executable version $actual, expected $Expected" }
  $registrations = @()
  foreach ($view in @([Microsoft.Win32.RegistryView]::Registry64, [Microsoft.Win32.RegistryView]::Registry32)) {
    $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser, $view)
    $entry = $null; $install = $null
    try {
      $entry = $base.OpenSubKey($regNames[1])
      if ($null -eq $entry) { continue }
      $install = $base.OpenSubKey($regNames[0])
      if ($null -eq $install -or [string]$entry.GetValue('DisplayVersion') -cne $Expected) { throw 'Installed registration/version missing or wrong' }
      $location = [IO.Path]::GetFullPath([string]$install.GetValue('InstallLocation')).TrimEnd([IO.Path]::DirectorySeparatorChar)
      if (-not $location.Equals($installDir, [StringComparison]::OrdinalIgnoreCase)) { throw 'Installed registration points outside owned target' }
      $registrations += @{ view = $view.ToString(); displayVersion = $entry.GetValue('DisplayVersion'); installLocation = $location }
    } finally {
      if ($entry) { $entry.Dispose() }; if ($install) { $install.Dispose() }; $base.Dispose()
    }
  }
  if ($registrations.Count -eq 0) { throw 'No actual installed registration; cleanup assertions would be vacuous' }
  Save-Json "installed-registration-$Expected.json" $registrations
  Save-Json "installed-version-$Expected.json" @{ fileVersion = $info.FileVersion; productVersion = $info.ProductVersion; sha256 = (Hash $installedExe) }
}
function Assert-Smoke([string]$ResultFile) {
  $value = Get-Content -LiteralPath $ResultFile -Raw | ConvertFrom-Json
  if ($value.status -cne 'pass' -or $value.modelResults.Count -ne 2) { throw 'Old installed smoke incomplete' }
  foreach ($model in @('k3', 'k3-256k')) {
    $entry = @($value.modelResults | Where-Object { $_.model -ceq $model })
    if ($entry.Count -ne 1 -or $entry[0].requests -ne 2 -or -not $entry[0].secondTurnReplayedReasoning) { throw 'Old installed multi-turn smoke failed' }
  }
  if ($value.authorizationDenyNetworkRequests -ne 0 -or $value.rollbackDenyNetworkRequests -ne 0) { throw 'Old installed deny smoke observed network requests' }
}
function Assert-OwnedExited {
  $deadline = [DateTime]::UtcNow.AddSeconds(15)
  do {
    Observe-Owned
    $remaining = @(Get-CimInstance Win32_Process | Where-Object { Is-OwnedPath $_.ExecutablePath })
    foreach ($item in @($owned.Values)) {
      $live = @(Get-CimInstance Win32_Process -Filter "ProcessId = $($item.pid)")
      if ($live.Count -gt 0 -and $live[0].CreationDate.ToUniversalTime().Ticks -eq $item.creationTicks) { $remaining += $live }
    }
    if ($remaining.Count -eq 0) { return }
    if ([DateTime]::UtcNow -ge $deadline) { throw 'Owned processes did not naturally exit; no upgrade authorized' }
    Start-Sleep -Milliseconds 100
  } while ($true)
}
function Assert-OldReleaseIdentity {
  $ref = Api '/git/ref/tags/desktop-v1.6.2'
  if ($ref.object.type -cne 'commit' -or $ref.object.sha -cne 'c1775bd6d7b9ae5dea42a1988cb31eafac982e63') { throw 'Old tag identity changed' }
  $old = Api '/releases/tags/desktop-v1.6.2'
  if ([long]$old.id -ne 434979678 -or $old.tag_name -cne 'desktop-v1.6.2' -or $old.draft -ne $false -or $old.prerelease -ne $false -or -not $old.published_at) { throw 'Old release identity changed' }
  $assets = @($old.assets | Where-Object { $_.name -ceq 'xiaok-setup-1.6.2.exe' })
  if ($assets.Count -ne 1 -or [long]$assets[0].id -ne 712793287 -or [long]$assets[0].size -ne 223003735 -or $assets[0].state -cne 'uploaded') { throw 'Old installer identity changed' }
  return @{ release = $old; asset = $assets[0]; tag = $ref }
}
function Get-VerifiedOldInstaller {
  $before = Assert-OldReleaseIdentity
  $file = Join-Path $root 'xiaok-setup-1.6.2.exe'
  $downloadHeaders = $headers.Clone(); $downloadHeaders.Accept = 'application/octet-stream'
  Invoke-WebRequest -Uri 'https://api.github.com/repos/kaisersong/xiaok-cli/releases/assets/712793287' -Headers $downloadHeaders -OutFile $file
  if ((Get-Item -LiteralPath $file).Length -ne 223003735 -or (Hash $file) -cne 'e66856df3b267da6c292a987f663c86fa9342e928c4c81ed08ff44c46f87eeae') { throw 'Old installer SHA256/size mismatch' }
  $after = Assert-OldReleaseIdentity
  if ($before.asset.updated_at -cne $after.asset.updated_at) { throw 'Old installer changed during download' }
  $receipt.oldAssetUpdatedAt = $after.asset.updated_at
  Save-Json 'old-published-before.json' $before
  Save-Json 'old-published-after-download.json' $after
  return $file
}
