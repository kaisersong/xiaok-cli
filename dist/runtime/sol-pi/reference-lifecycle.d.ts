import { type ProtectedObservationReference } from '../../ai/runtime/protected-observation-closure.js';
export declare const REFERENCE_LIFECYCLE_RESERVED_BYTES: number;
export interface ObservationReferenceOwnerFacts extends ProtectedObservationReference {
    referenceId: string;
}
export type ObservationReferenceOwnerResolution = {
    state: 'retained' | 'unknown';
} | {
    state: 'deleted';
    deletionReceiptId: string;
    deletedAt: number;
};
/** Main/CLI host only. Possession of this object is not exposed through tools or IPC.
 * begin is called only after the host admits an actual user deletion; completed
 * means the host's durable deletion journal committed, never mere file absence. */
export declare class ReferenceDeletionReceiptStore {
    private db;
    constructor(profileRoot: string);
    begin(input: {
        ownerId: string;
        operationId: string;
        references: ProtectedObservationReference[];
        deletedAt: number;
        hostOwnerId?: string;
    }): string;
    complete(id: string): void;
    pending(): Array<{
        id: string;
        ownerId: string;
        operationId: string;
        hostOwnerId?: string;
    }>;
    resolve(facts: ObservationReferenceOwnerFacts): ObservationReferenceOwnerResolution;
    close(): void;
}
