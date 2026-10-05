import type { ReceiverClockEvidence } from './receiver-store.js';
/** Raw kernel measurement, not installation qualification. The installed factory
 * below verifies the immutable executable before using its results as local time. */
export declare function readKernelContinuousNanoseconds(helperExecutable: string): bigint;
/** Same-machine protected authority only: no remote/UTC accuracy assertion.
 * Each startup has a fresh domain. Timestamp units are continuous kernel ms,
 * including sleep; the receiver must sample again inside its commit transaction. */
export declare function createInstalledLocalContinuousClock(helperExecutable: string): Readonly<{
    domainId: string;
    evidenceHash: string;
    sample(): Readonly<ReceiverClockEvidence>;
}>;
