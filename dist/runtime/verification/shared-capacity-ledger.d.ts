import { type SharedCapacityWriteContext } from './shared-capacity-command-dispatch.js';
import { type MetadataWriteContext } from './capacity-ledger-command-dispatch.js';
import type { Database } from 'better-sqlite3';
export declare function assertSharedCapacityLedgerDatabase(ledger: object, database: Database, authorityId: string): void;
export declare function assertSharedCapacityLedgerAuthority(ledger: object, authority: object): void;
export declare const SHARED_CAPACITY_PARTITIONS: Readonly<{
    control: number;
    rollback: number;
    outbox: number;
    auxiliary: number;
    counter: number;
    reference: number;
    'compound-domain': number;
    'canonical-alias': number;
    egress: number;
    participant: number;
    archive: number;
}>;
export type CapacityPartition = keyof typeof SHARED_CAPACITY_PARTITIONS;
export type CapacityState = 'reserved' | 'committed' | 'release_pending' | 'released' | 'unknown' | 'transferred';
export interface CapacityProposal {
    operationId: string;
    resourceId: string;
    generation: number;
    partition: CapacityPartition;
    bytes: number;
    bindingHash: string;
}
export interface CapacityRecord extends CapacityProposal {
    poolId: string;
    sessionKey: string;
    producerKey: string;
    state: CapacityState;
    revision: number;
    wasUnknown: boolean;
}
declare const brand: unique symbol;
export interface CapacityOwner {
    readonly [brand]: true;
}
export interface CapacityAttributionInput {
    physicalOwner: CapacityOwner;
    beneficiaryOwner: CapacityOwner;
    operationId: string;
}
export interface CapacityAttributionRecord {
    readonly poolId: string;
    readonly operationId: string;
    readonly physicalTupleHash: string;
    readonly physicalSessionKey: string;
    readonly physicalProducerKey: string;
    readonly beneficiarySessionKey: string;
    readonly beneficiaryProducerKey: string;
    readonly bytes: number;
    readonly charged: boolean;
}
export interface CapacityReservationBatch {
    reserveWithCommit(entries: readonly {
        owner: CapacityOwner;
        proposal: CapacityProposal;
    }[], commit: (allocations: readonly Readonly<{
        record: Readonly<CapacityRecord>;
        created: boolean;
    }>[], transaction: CapacityTransaction) => void): void;
}
export interface CapacityMetadataEntry {
    owner: CapacityOwner;
    proposal: CapacityProposal;
    beneficiaries: readonly CapacityOwner[];
}
export interface CapacityMetadataAllocation {
    readonly allocation: Readonly<{
        record: Readonly<CapacityRecord>;
        created: boolean;
    }>;
    readonly attributions: readonly Readonly<{
        record: Readonly<CapacityAttributionRecord>;
        created: boolean;
    }>[];
}
export declare function consumeSharedCapacityCommandContext(context: SharedCapacityWriteContext, ledger: object, database: Database, command: object): void;
export declare function consumeCapacityMetadataContext(context: MetadataWriteContext, ledger: object, database: Database, command: object): readonly CapacityMetadataAllocation[];
export interface CapacityTransaction {
    run(database: Database, work: () => void): void;
}
export interface CapacityMetadataReplacementMember {
    owner: CapacityOwner;
    operationId: string;
}
export interface CapacityMetadataReplacementRequest {
    replacementId: string;
    intentId: string;
    sources: readonly CapacityMetadataReplacementMember[];
    staging: readonly CapacityMetadataReplacementMember[];
    unusedCapacity: readonly CapacityMetadataReplacementMember[];
    targets: readonly CapacityMetadataEntry[];
    proof: object;
}
export interface CapacityMetadataReplacementFacts {
    readonly poolId: string;
    readonly authorityId: string;
    readonly replacementId: string;
    readonly intentId: string;
    readonly old: readonly Readonly<{
        role: 'source' | 'staging' | 'unused';
        record: Readonly<CapacityRecord>;
        attributions: readonly Readonly<CapacityAttributionRecord>[];
    }>[];
    readonly targets: readonly Readonly<{
        proposal: Readonly<CapacityProposal>;
        owner: Readonly<Identity>;
        beneficiaries: readonly Readonly<Identity>[];
    }>[];
}
export interface CapacityMetadataReplacementPreparation {
    readonly replacementId: string;
    readonly intentId: string;
    readonly requestHash: string;
    readonly state: 'prepared';
}
export interface CapacityMetadataReplacementCommitResult {
    readonly replacementId: string;
    readonly intentId: string;
    readonly requestHash: string;
    readonly state: 'committed';
    readonly commitSequence: number;
    readonly resultHash: string;
    readonly old: readonly Readonly<{
        role: 'source' | 'staging' | 'unused';
        record: Readonly<CapacityRecord>;
        attributions: readonly Readonly<CapacityAttributionRecord>[];
    }>[];
    readonly targets: readonly Readonly<{
        record: Readonly<CapacityRecord>;
        attributions: readonly Readonly<CapacityAttributionRecord>[];
    }>[];
}
export interface CapacityMetadataReplacementCommitContext {
    readonly __metadataReplacementCommitContext?: never;
}
export declare function consumeCapacityMetadataReplacementContext(context: CapacityMetadataReplacementCommitContext, ledger: object, database: Database, proof: object): Readonly<CapacityMetadataReplacementCommitResult>;
interface Identity {
    sessionKey: string;
    producerKey: string;
}
/** Capacity facts only. This module does not authorize a writer, choose a caller's
 * profile or turn an allocation into proof of resource creation/deletion. */
export declare function createSharedCapacityLedger(authority: object): Readonly<{
    reserveCommand(command: object): Readonly<CapacityRecord> | Readonly<{
        record: Readonly<CapacityRecord>;
        created: false;
    }> | Readonly<{
        record: Readonly<CapacityRecord>;
        created: true;
    }> | undefined;
    reserveBatchCommand(command: object, parentContext: SharedCapacityWriteContext): void;
    reserveMetadata(raw: readonly CapacityMetadataEntry[]): readonly CapacityMetadataAllocation[];
    reserveMetadataCommand(command: object): readonly CapacityMetadataAllocation[];
    prepareMetadataReplacement(raw: CapacityMetadataReplacementRequest): Readonly<CapacityMetadataReplacementPreparation>;
    commitMetadataReplacement(raw: CapacityMetadataReplacementRequest, proof: object): Readonly<CapacityMetadataReplacementCommitResult>;
    attributeSession(raw: CapacityAttributionInput): Readonly<{
        record: Readonly<CapacityAttributionRecord>;
        created: false;
    }> | Readonly<{
        record: Readonly<CapacityAttributionRecord>;
        created: true;
    }>;
    querySessionAttribution(raw: CapacityAttributionInput): Readonly<CapacityAttributionRecord> | undefined;
    bindOwner(binding: object): CapacityOwner;
    reserve(token: CapacityOwner, raw: CapacityProposal): Readonly<{
        record: Readonly<CapacityRecord>;
        created: false;
    }> | Readonly<{
        record: Readonly<CapacityRecord>;
        created: true;
    }>;
    commit(token: CapacityOwner, operationId: string): Readonly<CapacityRecord>;
    requestRelease(token: CapacityOwner, operationId: string): Readonly<CapacityRecord>;
    markUnknown(token: CapacityOwner, operationId: string): Readonly<CapacityRecord>;
    release(token: CapacityOwner, operationId: string, receipt: object): Readonly<CapacityRecord>;
    query(token: CapacityOwner, operationId: string): Readonly<CapacityRecord> | undefined;
    usage(): Readonly<{
        chargedBytes: number;
        partitions: Readonly<{
            [k: string]: number;
        }>;
    }>;
    close(): void;
}>;
export {};
