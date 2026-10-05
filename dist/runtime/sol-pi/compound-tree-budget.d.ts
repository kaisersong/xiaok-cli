import type { CompoundDispatchIdentity } from './compound-operation.js';
/** Whole-tree accounting facts. These do not grant execution or authenticate
 * child retirement. Root CAS must precede any child journal publication. */
export interface CompoundTreeAllocationInput {
    dispatch: CompoundDispatchIdentity;
    inputHash: string;
    recordKind: 'native' | 'provider' | 'delegation' | 'turn';
}
export interface CompoundTreeAllocation extends CompoundTreeAllocationInput {
    id: string;
    state: 'reserved' | 'tombstone';
}
export interface CompoundTreeBudget {
    version: 1;
    rootSessionIdentity: string;
    generation: number;
    allocations: CompoundTreeAllocation[];
}
export declare const COMPOUND_TREE_LIMITS: Readonly<{
    active: 256;
    identities: 4096;
    bytes: number;
    indexBytes: number;
    sessionMetadataBytes: 8192;
    recordBytes: 32768;
    tombstoneBytes: 1024;
}>;
export declare function validateCompoundTreeBudget(value: unknown): CompoundTreeBudget;
export declare function reserveCompoundTreeAllocation(previous: CompoundTreeBudget | undefined, rootSessionIdentity: string, value: CompoundTreeAllocationInput): {
    budget: CompoundTreeBudget;
    allocationId: string;
    created: boolean;
};
export declare function mergeCompoundTreeBudgets(previous: CompoundTreeBudget | undefined, next: CompoundTreeBudget | undefined): CompoundTreeBudget | undefined;
