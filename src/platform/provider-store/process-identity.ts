/**
 * Process start identity (design v58 §4.4).
 *
 * A bare pid is not an identity: pids are reused, so a stale claim/pin whose pid
 * happens to be alive again must not look live. Linux reads kernel boot/start ticks; other POSIX reads the start time with
 * fixed `ps` arguments; Windows reads CreationDate/ParentProcessId through a
 * fixed-allowlist PowerShell CIM query. When the probe itself is unavailable we
 * fail closed (return `unknown`) rather than guessing "dead", because guessing
 * dead is what deletes a live owner's claim.
 */

import { spawnSync } from 'node:child_process';
import {readFileSync} from 'node:fs';
import type { ProcessIdentity } from './plugin-claim-lock.js';

export type IdentityProbeResult =
  | { kind: 'alive'; identity: ProcessIdentity }
  | { kind: 'dead' }
  | { kind: 'unknown'; diagnostic: string };

/** Kernel start ticks plus boot identity avoid both PID reuse and host reboot. */
function probeLinux(pid:number):IdentityProbeResult {
  try {
    const boot=readFileSync('/proc/sys/kernel/random/boot_id','utf8').trim();
    const raw=readFileSync(`/proc/${pid}/stat`,'utf8');
    if(!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(boot)||raw.length>8192||!raw.startsWith(`${pid} (`))throw Error('invalid proc identity');
    const end=raw.lastIndexOf(')'),fields=raw.slice(end+1).trim().split(/\s+/);
    if(end<3||fields.length<20||!/^\d{1,32}$/.test(fields[19]!)||BigInt(fields[19]!)===0n||!/^[RSDZTWtXxKWPI]$/.test(fields[0]!))throw Error('invalid proc identity');
    if(['Z','X','x'].includes(fields[0]!))return {kind:'unknown',diagnostic:'proc process exiting'};
    return {kind:'alive',identity:{pid,startIdentity:`linux-proc-v1:${boot}:${fields[19]}`}};
  }catch(error){
    if((error as NodeJS.ErrnoException).code==='ENOENT'){
      try{process.kill(pid,0);}catch(probe){if((probe as NodeJS.ErrnoException).code==='ESRCH')return {kind:'dead'};}
    }
    return {kind:'unknown',diagnostic:'proc identity unavailable'};
  }
}

/** POSIX: `ps -o lstart= -o etime= -p <pid>` is stable across macOS and Linux. */
function probePosix(pid: number): IdentityProbeResult {
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
  if (!startIdentity) return { kind: 'dead' };
  return { kind: 'alive', identity: { pid, startIdentity } };
}

function probeWindows(pid: number): IdentityProbeResult {
  const result = spawnSync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-Command',
    `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CreationDate`,
  ], { encoding: 'utf8', windowsHide: true });
  if (result.error) {
    return { kind: 'unknown', diagnostic: `powershell failed: ${result.error.message}` };
  }
  if (result.status !== 0) {
    return { kind: 'unknown', diagnostic: `powershell exited ${result.status}` };
  }
  const startIdentity = (result.stdout ?? '').trim();
  if (!startIdentity) return { kind: 'dead' };
  return { kind: 'alive', identity: { pid, startIdentity } };
}

export function probeProcessIdentity(pid: number): IdentityProbeResult {
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    return { kind: 'unknown', diagnostic: `invalid pid ${pid}` };
  }
  return process.platform === 'linux'?probeLinux(pid):process.platform === 'win32' ? probeWindows(pid) : probePosix(pid);
}

export function selfProcessIdentity(): ProcessIdentity {
  const probe = probeProcessIdentity(process.pid);
  if (probe.kind === 'alive') return probe.identity;
  // Our own process is alive by definition; fall back to a stable in-process
  // marker so a probe outage can never make us claim to be dead.
  return { pid: process.pid, startIdentity: `self:${process.pid}` };
}

/**
 * Adapter for the claim lock: `null` means proven dead. An unknown probe throws,
 * because deleting another owner's claim on a guess is the exact v1 defect.
 */
export function probeIdentityOrFailClosed(pid: number): ProcessIdentity | null {
  const probe = probeProcessIdentity(pid);
  if (probe.kind === 'alive') return probe.identity;
  if (probe.kind === 'dead') return null;
  throw new Error(`plugin_lock_identity_unreadable: ${probe.diagnostic}`);
}
