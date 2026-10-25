param([Parameter(Mandatory=$true)][string]$Request)
$ErrorActionPreference = 'Stop'
$r = Get-Content -LiteralPath $Request -Raw | ConvertFrom-Json
# ArgumentLine is produced by Python subprocess.list2cmdline, never Invoke-Expression.
$p = Start-Process -FilePath $r.executable -ArgumentList $r.argumentLine `
    -WorkingDirectory $r.cwd -RedirectStandardOutput $r.stdout `
    -RedirectStandardError $r.stderr -NoNewWindow -Wait -PassThru
if (-not $p.HasExited) { throw 'owned_process_not_exited' }
@{ pid=$p.Id; exitCode=$p.ExitCode; treeWaitReturned=$true; hasExited=$p.HasExited } |
    ConvertTo-Json -Compress
exit 0
