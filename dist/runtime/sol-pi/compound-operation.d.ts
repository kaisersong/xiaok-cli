import { type ManagedTurnLedger } from './compound-managed-turn.js';
import { type CompoundProviderAttempt, type ProviderAttemptTombstoneBinding } from './compound-provider-attempt.js';
import type { QuiescenceExpectation } from '../isolated-execution/physical-quiescence.js';
import { type DirectOperationRecord } from './compound-direct-operation.js';
import { type CompoundTreeBudget } from './compound-tree-budget.js';
export declare const COMPOUND_LIMITS: Readonly<{
    operations: 256;
    tombstones: 4096;
    recordBytes: 32768;
    tombstoneBytes: 1024;
    indexBytes: number;
    bytes: number;
}>;
export interface CompoundDispatchIdentity {
    sessionIdentity: string;
    hostProviderInvocationId: string;
    originalToolUseId: string;
}
export type CompoundStage = 'prepared' | 'edit_started' | 'edit_committed' | 'validation_started' | 'settled' | 'outcome_unknown';
export type CompoundStepStatus = 'not_started' | 'pending' | 'denied' | 'succeeded' | 'failed' | 'cancelled' | 'unknown';
export interface CompoundOperationInput {
    dispatch: CompoundDispatchIdentity;
    inputHash: string;
    toolName: 'edit' | 'write';
    ownerId: string;
    requestSource: 'user' | 'agent' | 'scheduler';
    scopeId: string;
    permissionGeneration: number;
}
export interface CompoundOperationRecord extends CompoundOperationInput {
    id: string;
    editInvocationId: string;
    validationInvocationId: string;
    finalInputHash: string | null;
    stage: CompoundStage;
    editStatus: CompoundStepStatus;
    validation: {
        status: CompoundStepStatus;
        exitCode: number | null;
    };
    file: {
        path: string;
        beforeHash: string | null;
        afterHash: string;
    } | null;
    physicalExecution?: QuiescenceExpectation;
    reservation: {
        recordBytes: number;
        tombstoneBytes: number;
        tombstoneSlot: 1;
    };
}
export interface CompoundOperationTombstone {
    id: string;
    dispatch: CompoundDispatchIdentity;
    inputHash: string;
    terminalKind: 'settled';
    providerAttempt?: ProviderAttemptTombstoneBinding;
}
export interface CompoundOperationLedger {
    version: 1;
    generation: number;
    operations: CompoundOperationRecord[];
    directOperations?: DirectOperationRecord[];
    providerAttempts?: CompoundProviderAttempt[];
    treeBudget?: CompoundTreeBudget;
    managedTurns?: ManagedTurnLedger;
    tombstones: CompoundOperationTombstone[];
}
export declare function createCompoundOperationLedger(): CompoundOperationLedger;
export declare function validateCompoundOperationLedger(value: unknown): CompoundOperationLedger;
export declare function createOrGetCompoundOperation(value: CompoundOperationLedger, input: CompoundOperationInput): {
    ledger: CompoundOperationLedger;
    operation: CompoundOperationTombstone | CompoundOperationRecord;
    created: boolean;
};
export interface CompoundAdvance {
    stage: CompoundStage;
    physicalExecution?: QuiescenceExpectation;
    finalInputHash?: string;
    editStatus?: CompoundStepStatus;
    validation?: {
        status: CompoundStepStatus;
        exitCode: number | null;
    };
    file?: NonNullable<CompoundOperationRecord['file']>;
}
export declare function advanceCompoundOperation(value: CompoundOperationLedger, operationId: string, change: CompoundAdvance): CompoundOperationLedger;
/** Pure journal transform; the host service must authorize user cleanup. */
export declare function retireCompoundOperation(value: CompoundOperationLedger, operationId: string): CompoundOperationLedger;
export declare function mergeCompoundOperationLedgers(previous: CompoundOperationLedger | undefined, next: CompoundOperationLedger | undefined): CompoundOperationLedger | undefined;
