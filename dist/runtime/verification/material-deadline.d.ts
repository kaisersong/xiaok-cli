import type { ReceiverClockEvidence } from './receiver-store.js';
export interface MaterialDeadline {
    readonly wallExpiresAt: number;
    readonly continuousExpiresAt: number;
    readonly clockDomainId: string;
    readonly clockQualificationEpoch: number;
    readonly preparedLowerBound: number;
}
/** Called exactly once at server prepare. Later native approval never renews it.
 * Clock evidence must come from the installed broker, not the caller DTO. */
export declare function freezeMaterialDeadline(input: {
    requestedWallExpiry: number;
    wallNow: number;
    clock: ReceiverClockEvidence;
    maximumLifetimeMs: number;
}): Readonly<MaterialDeadline>;
/** Wall time can only further deny; rolling it backwards cannot extend the
 * already frozen continuous deadline. Includes GUI/IPC time and sleep. */
export declare function assertMaterialDeadline(deadline: Readonly<MaterialDeadline>, input: {
    wallNow: number;
    clock: ReceiverClockEvidence;
}): void;
