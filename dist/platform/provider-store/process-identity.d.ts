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
import type { ProcessIdentity } from './plugin-claim-lock.js';
export type IdentityProbeResult = {
    kind: 'alive';
    identity: ProcessIdentity;
} | {
    kind: 'dead';
} | {
    kind: 'unknown';
    diagnostic: string;
};
export declare function probeProcessIdentity(pid: number): IdentityProbeResult;
export declare function selfProcessIdentity(): ProcessIdentity;
/**
 * Adapter for the claim lock: `null` means proven dead. An unknown probe throws,
 * because deleting another owner's claim on a guess is the exact v1 defect.
 */
export declare function probeIdentityOrFailClosed(pid: number): ProcessIdentity | null;
