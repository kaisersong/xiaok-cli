import type { CompoundDispatchIdentity } from './compound-operation.js';
export interface ManagedTurnIdentity {
    admissionId: string;
    childSessionId: string;
    operationId: string;
    turnId: string;
    rootEpoch: number;
    inputHash: string;
    closureDigest: string;
}
export type ManagedTurnState = 'prepared' | 'active' | 'retiring' | 'drained' | 'cancelled_before_activation' | 'unknown';
export interface ManagedTurnRecord extends ManagedTurnIdentity {
    generation: number;
    state: ManagedTurnState;
    appliedDigest: string | null;
}
export interface ManagedTurnLedger {
    version: 1;
    records: ManagedTurnRecord[];
}
export declare function getManagedTurnDispatch(record: ManagedTurnRecord): CompoundDispatchIdentity;
/** Serialized history only: neither state nor this helper issues an execution,
 * Main approval, provider admission, or physical drain capability. */
export declare function validateManagedTurnLedger(value: unknown): ManagedTurnLedger;
export declare function prepareManagedTurn(previous: ManagedTurnLedger | undefined, input: ManagedTurnIdentity): {
    ledger: ManagedTurnLedger;
    record: ManagedTurnRecord;
    created: boolean;
};
export declare function advanceManagedTurn(previous: ManagedTurnLedger, generation: number, change: {
    state: ManagedTurnState;
    appliedDigest?: string;
}): ManagedTurnLedger;
export declare function mergeManagedTurnLedgers(previous: ManagedTurnLedger | undefined, next: ManagedTurnLedger | undefined): ManagedTurnLedger | undefined;
