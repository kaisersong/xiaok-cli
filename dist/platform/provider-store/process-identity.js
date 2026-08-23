/**
 * Process start identity (design v58 §4.4).
 *
 * A bare pid is not an identity: pids are reused, so a stale claim/pin whose pid
 * happens to be alive again must not look live. POSIX reads the start time with
 * fixed `ps` arguments; Windows reads CreationDate/ParentProcessId through a
 * fixed-allowlist PowerShell CIM query. When the probe itself is unavailable we
 * fail closed (return `unknown`) rather than guessing "dead", because guessing
 * dead is what deletes a live owner's claim.
 */
import { spawnSync } from 'node:child_process';
/** POSIX: `ps -o lstart= -o etime= -p <pid>` is stable across macOS and Linux. */
function probePosix(pid) {
    const result = spawnSync('/bin/ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8' });
    if (result.error) {
        return { kind: 'unknown', diagnostic: `ps failed: ${result.error.message}` };
    }
    if (result.status === 1 && (result.stdout ?? '').trim() === '') {
        return { kind: 'dead' };
    }
    if (result.status !== 0) {
        return { kind: 'unknown', diagnostic: `ps exited ${result.status}` };
    }
    const startIdentity = (result.stdout ?? '').trim();
    if (!startIdentity)
        return { kind: 'dead' };
    return { kind: 'alive', identity: { pid, startIdentity } };
}
function probeWindows(pid) {
    const result = spawnSync('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-Command',
        `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CreationDate`,
    ], { encoding: 'utf8' });
    if (result.error) {
        return { kind: 'unknown', diagnostic: `powershell failed: ${result.error.message}` };
    }
    if (result.status !== 0) {
        return { kind: 'unknown', diagnostic: `powershell exited ${result.status}` };
    }
    const startIdentity = (result.stdout ?? '').trim();
    if (!startIdentity)
        return { kind: 'dead' };
    return { kind: 'alive', identity: { pid, startIdentity } };
}
export function probeProcessIdentity(pid) {
    if (!Number.isSafeInteger(pid) || pid <= 0) {
        return { kind: 'unknown', diagnostic: `invalid pid ${pid}` };
    }
    return process.platform === 'win32' ? probeWindows(pid) : probePosix(pid);
}
export function selfProcessIdentity() {
    const probe = probeProcessIdentity(process.pid);
    if (probe.kind === 'alive')
        return probe.identity;
    // Our own process is alive by definition; fall back to a stable in-process
    // marker so a probe outage can never make us claim to be dead.
    return { pid: process.pid, startIdentity: `self:${process.pid}` };
}
/**
 * Adapter for the claim lock: `null` means proven dead. An unknown probe throws,
 * because deleting another owner's claim on a guess is the exact v1 defect.
 */
export function probeIdentityOrFailClosed(pid) {
    const probe = probeProcessIdentity(pid);
    if (probe.kind === 'alive')
        return probe.identity;
    if (probe.kind === 'dead')
        return null;
    throw new Error(`plugin_lock_identity_unreadable: ${probe.diagnostic}`);
}
