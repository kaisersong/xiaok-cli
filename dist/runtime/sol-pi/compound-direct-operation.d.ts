import { type CompoundDelegationRecord } from './compound-delegation-record.js';
import { type CompoundOperationLedger, type CompoundOperationInput, type CompoundOperationTombstone } from './compound-operation.js';
import type { QuiescenceExpectation } from '../isolated-execution/physical-quiescence.js';
export interface DirectOperationInput extends Omit<CompoundOperationInput, 'toolName'> {
    toolName: string;
}
export interface DirectOperationRecord extends DirectOperationInput {
    id: string;
    finalInputHash: string | null;
    stage: 'prepared' | 'started' | 'settled' | 'outcome_unknown';
    outcome: null | 'denied' | 'cancelled' | 'invalid' | 'completed' | 'failed' | 'unknown';
    quiescence: null | 'synchronous_file' | 'isolated_tree' | 'delegated_tree' | 'metadata_commit';
    physicalExecution: QuiescenceExpectation | null;
    /** A main database commit is not evidence that a child or process stopped. */
    metadataCommit?: {
        adapter: 'desktop-service-metadata-v1';
        kind: 'send' | 'followup';
        operationId: string;
        requestHash: string;
        resultHash: string;
        groupId: string;
        actorId: string;
        epoch: number;
    };
    delegation?: CompoundDelegationRecord;
    fileFacts?: {
        adapter: 'synchronous-native-file-v1';
        path: string;
        beforeHash: string | null;
        afterHash: string;
    };
    reservation: {
        recordBytes: number;
        tombstoneBytes: number;
        tombstoneSlot: 1;
    };
}
export declare function validateDirectOperationRecord(v: unknown): asserts v is DirectOperationRecord;
export declare function assertDirectOperationTransition(previous: DirectOperationRecord, next: DirectOperationRecord): void;
/** Pure facts transform. Only the host execution owner may authenticate terminal
 * receipts and commit this ledger through an active store CAS lease. */
export declare function createOrGetDirectOperation(value: CompoundOperationLedger, input: DirectOperationInput): {
    ledger: CompoundOperationLedger;
    operation: DirectOperationRecord | CompoundOperationTombstone;
    created: boolean;
};
export interface DirectOperationAdvance {
    metadataCommit?: DirectOperationRecord['metadataCommit'];
    delegation?: CompoundDelegationRecord;
    fileFacts?: DirectOperationRecord['fileFacts'];
    stage: DirectOperationRecord['stage'];
    finalInputHash?: string;
    outcome?: DirectOperationRecord['outcome'];
    quiescence?: DirectOperationRecord['quiescence'];
    physicalExecution?: QuiescenceExpectation;
}
export declare function advanceDirectOperation(value: CompoundOperationLedger, id: string, change: DirectOperationAdvance): CompoundOperationLedger;
export declare function retireDirectOperation(value: CompoundOperationLedger, id: string): CompoundOperationLedger;
