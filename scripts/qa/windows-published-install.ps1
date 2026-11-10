#requires -Version 7.2
[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$Version,
  [Parameter(Mandatory)][string]$Tag,
  [Parameter(Mandatory)][string]$FullSHA,
  [Parameter(Mandatory)][string]$ExpectedInstallerSHA256
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repo = 'kaisersong/xiaok-cli'
$approvedSHA = '6770092945a42fb0e45ef0d68d0971bfc01b51a8'
$approvedInstallerSHA256 = 'b98433d1ea78b5076eb3bbf4afdfcf444fa34515e7b8618405eb804ea2cb57a2'
$approvedInstallerBytes = 222949706
$approvedReleaseID = 419987808
$approvedAssetID = 663668714
if ($Version -cnotmatch '^(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})$' -or
    $Tag -cne "desktop-v$Version" -or $FullSHA -cnotmatch '^[0-9a-f]{40}$' -or
    $ExpectedInstallerSHA256 -cnotmatch '^[0-9a-f]{64}$') { throw 'Invalid release identity input' }
if ($FullSHA -cne $approvedSHA -or $Version -cne '1.5.15' -or $ExpectedInstallerSHA256 -cne $approvedInstallerSHA256) { throw 'This bounded QA candidate is for the approved 677 release only' }
if (-not $IsWindows -or $env:RUNNER_OS -ne 'Windows' -or $env:RUNNER_ARCH -ne 'X64' -or
    $env:ImageOS -ne 'win22' -or $env:GITHUB_ACTIONS -ne 'true' -or $env:GITHUB_REPOSITORY -cne $repo) {
  throw 'Requires the fixed repository disposable windows-2022 x64 job'
}
if ($env:GITHUB_RUN_ID -cnotmatch '^[0-9]+$' -or $env:GITHUB_RUN_ATTEMPT -cnotmatch '^[1-9][0-9]*$' -or
    $env:GITHUB_SHA -cnotmatch '^[0-9a-f]{40}$' -or -not $env:GH_TOKEN) { throw 'Missing workflow identity/token' }
$root = [IO.Path]::GetFullPath((Join-Path $env:RUNNER_TEMP "xiaok-installed-qa-$env:GITHUB_RUN_ID-$env:GITHUB_RUN_ATTEMPT"))
if ($root -match "['`"`r`n]") { throw 'Unsafe owned temporary path for the fixed NSIS template' }
if (Test-Path -LiteralPath $root) { throw 'Refusing to reuse an occupied QA root' }
$evidence = Join-Path $root 'evidence'
$installDir = Join-Path $root 'target\xiaok'
$smokeRoot = Join-Path $root 'smoke'
$resultPath = Join-Path $smokeRoot 'result.json'
$installer = Join-Path $root "xiaok-setup-$Version.exe"
$installedExe = Join-Path $installDir 'xiaok.exe'
$uninstaller = Join-Path $installDir 'Uninstall xiaok.exe'
New-Item -ItemType Directory -Path $evidence, (Split-Path $installDir), $smokeRoot | Out-Null
$errors = [Collections.Generic.List[string]]::new()
$records = [Collections.Generic.List[object]]::new()
$owned = @{}
$forcedStops = [Collections.Generic.List[object]]::new()
$installStarted = $false
$preflightPassed = $false
$cache = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'xiaok-desktop-updater'
$shortcuts = @((Join-Path ([Environment]::GetFolderPath('DesktopDirectory')) 'xiaok.lnk'),
               (Join-Path ([Environment]::GetFolderPath('Programs')) 'xiaok.lnk'))
# UUID.v5(com.xiaok.desktop, electron-builder namespace), fixed by the 677 build inputs.
$guid = 'e915e417-4c7f-5880-944a-980493960d29'
$regNames = @("Software\$guid", "Software\Microsoft\Windows\CurrentVersion\Uninstall\$guid")
$headers = @{ Authorization = "Bearer $env:GH_TOKEN"; Accept = 'application/vnd.github+json'; 'X-GitHub-Api-Version' = '2022-11-28' }
$receipt = [ordered]@{ status = 'FAIL'; productReleaseSHA = $FullSHA; qaSourceSHA = $env:GITHUB_SHA;
  version = $Version; tag = $Tag; repository = $repo; runID = $env:GITHUB_RUN_ID; runAttempt = $env:GITHUB_RUN_ATTEMPT;
  scriptSHA256 = (Get-FileHash -LiteralPath $PSCommandPath -Algorithm SHA256).Hash.ToLowerInvariant(); root = $root;
  claim = 'Ordinary published NSIS installed-path packaged Kimi smoke only; no live model, full UI, ARM64, Goal14/CUA3, authority replacement or migration qualification' }
function Save-Json($Name, $Value) { $Value | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath (Join-Path $evidence $Name) -Encoding utf8 }
function Hash($Path) { (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant() }
function Is-OwnedPath([string]$Path) {
  $Path -and ([IO.Path]::GetFullPath($Path)).StartsWith($root + '\', [StringComparison]::OrdinalIgnoreCase)
}
function Assert-NoReparse([string]$Path) {
  $current = Get-Item -LiteralPath $Path -Force
  while ($current -and ((Is-OwnedPath $current.FullName) -or $current.FullName -eq $root)) {
    if (($current.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "Reparse point in owned executable path: $($current.FullName)" }
    $current = if ($current.PSIsContainer) { $current.Parent } else { $current.Directory }
  }
}
function Api([string]$Suffix) {
  if ($Suffix -notmatch '^/(releases|git)/[A-Za-z0-9_./-]+$') { throw 'Unexpected GitHub API suffix' }
  Invoke-RestMethod -Uri "https://api.github.com/repos/$repo$Suffix" -Headers $headers -Method Get
}
function Resolve-TagCommit {
  $ref = Api "/git/ref/tags/$Tag"
  $obj = $ref.object
  for ($i = 0; $i -lt 5; $i++) {
    if ($obj.sha -cnotmatch '^[0-9a-f]{40}$') { throw 'Invalid tag object identity' }
    if ($obj.type -ceq 'commit') {
      if ($obj.sha -cne $FullSHA) { throw 'Published tag commit does not match full release SHA' }
      return $ref
    }
    if ($obj.type -cne 'tag') { throw 'Unsupported tag object type' }
    $obj = (Api "/git/tags/$($obj.sha)").object
  }
  throw 'Tag indirection limit exceeded'
}
function Assert-Published($Release) {
  if ($Release.tag_name -cne $Tag -or $Release.draft -ne $false -or $Release.prerelease -ne $false -or
      -not $Release.published_at -or [long]$Release.id -ne $approvedReleaseID) { throw 'Requires an actually published normal release' }
}
function Assert-NoRegistry {
  foreach ($hive in @([Microsoft.Win32.RegistryHive]::CurrentUser, [Microsoft.Win32.RegistryHive]::LocalMachine)) {
    foreach ($view in @([Microsoft.Win32.RegistryView]::Registry64, [Microsoft.Win32.RegistryView]::Registry32)) {
      $baseKey = [Microsoft.Win32.RegistryKey]::OpenBaseKey($hive, $view)
      try {
        foreach ($name in $regNames) {
          $key = $baseKey.OpenSubKey($name)
          if ($null -ne $key) { $key.Dispose(); throw "Existing/retained app registration: $hive/$view/$name" }
        }
      } finally { $baseKey.Dispose() }
    }
  }
}
function Assert-NoForeignApp {
  $apps = @(Get-CimInstance Win32_Process -Filter "Name = 'xiaok.exe'")
  foreach ($app in $apps) {
    if (-not (Is-OwnedPath $app.ExecutablePath)) { throw "Foreign or unknown xiaok process; no action taken: $($app.ProcessId)" }
  }
}
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
$envNames = @('APPDATA','LOCALAPPDATA','TEMP','TMP','XIAOK_CONFIG_DIR','XIAOK_KIMI_PACKAGED_SMOKE_RESULT','XIAOK_DESKTOP_DISABLE_SINGLE_INSTANCE')
$savedEnv = @{}; foreach ($n in $envNames) { $savedEnv[$n] = [Environment]::GetEnvironmentVariable($n, 'Process') }
try {
  $ref = Resolve-TagCommit; $release = Api "/releases/tags/$Tag"; Assert-Published $release
  $assetName = "xiaok-setup-$Version.exe"
  $assets = @($release.assets | Where-Object { $_.name -ceq $assetName })
  if ($assets.Count -ne 1 -or $assets[0].state -cne 'uploaded' -or [long]$assets[0].id -ne $approvedAssetID -or [long]$assets[0].size -ne $approvedInstallerBytes) { throw 'Exact NSIS installer asset missing/ambiguous' }
  $asset = $assets[0]
  Save-Json 'published-before.json' @{ release = $release; tagRef = $ref; asset = $asset; expectedSHA256 = $ExpectedInstallerSHA256 }
  $downloadHeaders = $headers.Clone(); $downloadHeaders.Accept = 'application/octet-stream'
  Invoke-WebRequest -Uri "https://api.github.com/repos/$repo/releases/assets/$($asset.id)" -Headers $downloadHeaders -OutFile $installer
  if ((Get-Item -LiteralPath $installer).Length -ne $asset.size -or (Hash $installer) -cne $ExpectedInstallerSHA256) { throw 'Installer size/SHA256 mismatch' }
  $receipt.releaseID = $release.id; $receipt.assetID = $asset.id; $receipt.installerSHA256 = Hash $installer
  $again = Api "/releases/$($release.id)"; Assert-Published $again
  $same = @($again.assets | Where-Object { $_.id -eq $asset.id -and $_.name -ceq $assetName -and $_.size -eq $asset.size -and $_.updated_at -ceq $asset.updated_at })
  if ($same.Count -ne 1) { throw 'Published asset changed during download' }; $null = Resolve-TagCommit
  Assert-NoRegistry; Assert-NoForeignApp
  foreach ($path in @($cache) + $shortcuts) { if (Test-Path -LiteralPath $path) { throw "Occupied runner known-folder fixture: $path" } }
  $preflightPassed = $true
  $temp = Join-Path $root 'temp'; New-Item -ItemType Directory -Path $temp | Out-Null
  $env:TEMP = $temp; $env:TMP = $temp
  $installStarted = $true
  # /D must be last, without embedded quotes: exact bundled multiUser.nsh parsing.
  Run-Owned 'silent-install' $installer "/S /currentuser /D=$installDir"
  Assert-NoReparse $installedExe; Assert-NoReparse $uninstaller
  $receipt.installedExecutable = $installedExe; $receipt.installedExecutableSHA256 = Hash $installedExe
  $appData = Join-Path $smokeRoot 'appdata'; $localAppData = Join-Path $smokeRoot 'localappdata'; $tempDir = Join-Path $smokeRoot 'temp'
  New-Item -ItemType Directory -Path $appData, $localAppData, $tempDir | Out-Null
  $env:XIAOK_KIMI_PACKAGED_SMOKE_RESULT = $resultPath
  $env:XIAOK_DESKTOP_DISABLE_SINGLE_INSTANCE = '1'
  $env:APPDATA = $appData; $env:LOCALAPPDATA = $localAppData; $env:TEMP = $tempDir; $env:TMP = $tempDir
  $env:XIAOK_CONFIG_DIR = Join-Path $smokeRoot 'config'
  Run-Owned 'installed-packaged-kimi-smoke' $installedExe ''
  if (-not (Test-Path -LiteralPath $resultPath)) { throw 'Packaged Kimi smoke did not write its result' }
  $result = Get-Content -LiteralPath $resultPath -Raw | ConvertFrom-Json
  if ($result.status -ne 'pass' -or $result.modelResults.Count -ne 2) { throw 'Packaged Kimi smoke result is incomplete' }
  foreach ($model in @('k3', 'k3-256k')) {
    $entry = $result.modelResults | Where-Object { $_.model -eq $model }
    if (-not $entry -or $entry.requests -ne 2 -or -not $entry.secondTurnReplayedReasoning) { throw "Packaged Kimi multi-turn smoke failed for $model" }
  }
  if ($result.authorizationDenyNetworkRequests -ne 0 -or $result.rollbackDenyNetworkRequests -ne 0) { throw 'Packaged Kimi deny smoke observed a network request' }
  $canaryHit = Get-ChildItem -LiteralPath $smokeRoot -Recurse -File | Where-Object { $_.FullName -ne $resultPath } | Select-String -SimpleMatch 'PACKAGED_SMOKE_RUNTIME_ONLY' -List
  if ($canaryHit) { throw "Provider-private reasoning canary persisted at $($canaryHit.Path)" }
  Copy-Item -LiteralPath $resultPath -Destination (Join-Path $evidence 'smoke-result.json')
  $receipt.smokeResultSHA256 = Hash $resultPath
} catch { $errors.Add("body: $($_.Exception.ToString())") }
finally {
  try { Stop-JoinOwned } catch { $errors.Add("pre-uninstall owned drain: $($_.Exception.ToString())") }
  foreach ($n in $envNames) { [Environment]::SetEnvironmentVariable($n, $savedEnv[$n], 'Process') }
  $env:TEMP = Join-Path $root 'temp'; $env:TMP = $env:TEMP
  if ($installStarted) {
    try {
      Assert-NoForeignApp
      Assert-NoReparse $uninstaller
      $copy = Join-Path $root 'owned-uninstall.exe'; Copy-Item -LiteralPath $uninstaller -Destination $copy
      if ((Hash $copy) -cne (Hash $uninstaller)) { throw 'Uninstaller copy hash mismatch' }
      # Same copy + _?= pattern used by original NSIS uninstallOldVersion, with synchronous completion.
      Run-Owned 'silent-uninstall' $copy "/S /currentuser _?=$installDir"
      if ((Test-Path -LiteralPath $installedExe) -or (Test-Path -LiteralPath $installDir)) { throw 'Installed target remains after uninstaller exit' }
      Assert-NoRegistry
      foreach ($path in $shortcuts) { if (Test-Path -LiteralPath $path) { throw "Uninstaller retained owned shortcut: $path" } }
    } catch { $errors.Add("uninstall: $($_.Exception.ToString())") }
  }
  try { Stop-JoinOwned } catch { $errors.Add("final owned drain: $($_.Exception.ToString())") }
  if ($preflightPassed -and (Test-Path -LiteralPath $cache)) {
    try {
      if (((Get-Item -LiteralPath $cache -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Cache parent is a reparse point; retained' }
      $entries = @(Get-ChildItem -LiteralPath $cache -Force)
      if ($entries.Count -ne 1 -or $entries[0].Name -cne 'installer.exe' -or $entries[0].PSIsContainer -or
          ($entries[0].Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or (Hash $entries[0].FullName) -cne $ExpectedInstallerSHA256) { throw 'Unexpected known-folder cache; retained, not deleted' }
      Remove-Item -LiteralPath $entries[0].FullName; Remove-Item -LiteralPath $cache
    } catch { $errors.Add("owned installer cache: $($_.Exception.ToString())") }
  }
  try {
    $remaining = @(Get-CimInstance Win32_Process | Where-Object { Is-OwnedPath $_.ExecutablePath })
    if ($remaining.Count -ne 0) { throw 'Owned executable processes remain' }
    foreach ($item in @($owned.Values)) {
      $live = @(Get-CimInstance Win32_Process -Filter "ProcessId = $($item.pid)")
      if ($live.Count -gt 0 -and $live[0].CreationDate.ToUniversalTime().Ticks -eq $item.creationTicks) { throw "Recorded owned PID remains: $($item.pid)" }
    }
    $receipt.remainingOwnedPIDs = @($remaining | ForEach-Object { $_.ProcessId })
    if ($preflightPassed) {
      $null = Resolve-TagCommit; $finalRelease = Api "/releases/$($release.id)"; Assert-Published $finalRelease
      $finalAsset = @($finalRelease.assets | Where-Object { $_.id -eq $asset.id -and $_.name -ceq $assetName -and $_.size -eq $asset.size -and $_.updated_at -ceq $asset.updated_at })
      if ($finalAsset.Count -ne 1) { throw 'Published asset identity changed during QA' }
      Save-Json 'published-after.json' @{ release = $finalRelease; tagRef = (Resolve-TagCommit); installerSHA256 = $ExpectedInstallerSHA256 }
    }
  } catch { $errors.Add("final observation: $($_.Exception.ToString())") }
  foreach ($n in $envNames) { [Environment]::SetEnvironmentVariable($n, $savedEnv[$n], 'Process') }
  $receipt.errors = @($errors); $receipt.steps = @($records); $receipt.observedOwnedIdentities = @($owned.Values); $receipt.forcedStops = @($forcedStops)
  $receipt.finishedUTC = [DateTime]::UtcNow.ToString('o')
  if ($errors.Count -eq 0) { $receipt.status = 'PASS' }
  Save-Json 'RESULT.json' $receipt
}
if ($errors.Count -ne 0) { throw ($errors -join "`n") }
