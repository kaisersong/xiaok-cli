export declare const METADATA_EMERGENCY_BYTES: number;
export declare const METADATA_CAPACITY_METHODS: readonly ["capacity.metadata.prepare", "capacity.metadata.confirm", "capacity.metadata.query"];
export type MetadataCapacityMethod = typeof METADATA_CAPACITY_METHODS[number];
export interface MetadataCapacityPrepare {
    requestId: string;
    resourceId: string;
    expectedRevision: number;
    minimumPageCount: number;
}
export interface MetadataCapacityConfirm {
    requestId: string;
    resourceId: string;
    intentId: string;
    allocationDigest: string;
}
export interface MetadataCapacityQuery {
    resourceId: string;
    intentId: string;
}
export interface MetadataCapacityAllocation {
    resourceId: string;
    intentId: string;
    requestId: string;
    resourceRevision: number;
    writerGeneration: string;
    allocationDigest: string;
    beneficiaryCensusHash: string;
    pageSize: number;
    usableMaximumPageCount: number;
    chargedMaximumPageCount: number;
    journalMode: 'delete';
    synchronous: 'full';
    state: 'prepared' | 'confirmed' | 'unknown';
}
/** Pure wire validation; none of these values are a capacity owner or writer permit. */
export declare function parseMetadataCapacityPrepare(raw: unknown): Readonly<MetadataCapacityPrepare>;
export declare function parseMetadataCapacityConfirm(raw: unknown): Readonly<MetadataCapacityConfirm>;
export declare function parseMetadataCapacityQuery(raw: unknown): Readonly<MetadataCapacityQuery>;
export interface AuthenticatedMetadataCapacityTransport {
    call(method: MetadataCapacityMethod, payload: unknown, signal?: AbortSignal): Promise<unknown>;
    callSync(method: MetadataCapacityMethod, payload: unknown): unknown;
}
export declare function parseMetadataCapacityAllocation(raw: unknown): Readonly<MetadataCapacityAllocation>;
