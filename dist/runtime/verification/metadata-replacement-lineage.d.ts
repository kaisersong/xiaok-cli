import type { Database } from 'better-sqlite3';
import type { CapacityRecord, CapacityMetadataReplacementFacts, CapacityAttributionRecord, CapacityMetadataReplacementCommitResult } from './shared-capacity-ledger.js';
export declare function assertMetadataReplacementFees(f: Readonly<CapacityMetadataReplacementFacts>): void;
export declare function capacityRecordTuple(record: Readonly<CapacityRecord>): {
    poolId: string;
    sessionKey: string;
    producerKey: string;
    operationId: string;
    resourceId: string;
    generation: number;
    partition: import("./shared-capacity-ledger.js").CapacityPartition;
    bytes: number;
    bindingHash: string;
};
export declare function capacityAttributionTuple(record: Readonly<CapacityAttributionRecord>): {
    poolId: string;
    operationId: string;
    physicalTupleHash: string;
    physicalSessionKey: string;
    physicalProducerKey: string;
    beneficiarySessionKey: string;
    beneficiaryProducerKey: string;
    bytes: number;
};
export declare function metadataReplacementResultHash(result: Omit<CapacityMetadataReplacementCommitResult, 'resultHash'>): string;
/** Read-only audit of the original ledger, under its caller's one SQL snapshot.
 * No owner/proof issuance and no mutations live in this module. */
export declare function assertMetadataReplacementLineage(db: Database, poolId: string, authorityId: string): void;
