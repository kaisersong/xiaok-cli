declare const inventoryBrand: unique symbol;
export interface CompoundSourceInventory {
    readonly [inventoryBrand]: true;
}
export declare function assertCompoundSourceInventoryCurrent(value: CompoundSourceInventory): Readonly<{
    roots: readonly string[];
    snapshots: readonly Readonly<{
        root: string;
        sessionId: string;
        executionProtected: boolean;
        hasCompoundLedger: boolean;
        hasSemanticLedger: boolean;
        hasObservationClosure: boolean;
        hasUnsettledExecution: boolean;
    }>[];
    unclassifiedEntries: readonly string[];
    digest: string;
}>;
/** Read-only evidence. It neither proves process drain nor permits initialization.
 * Product hosts must supply their complete fixed/registered source-root census;
 * any unclassified entry requires explicit reconciliation, never omission. */
export declare function inspectCompoundSourceInventory(sourceRoots: readonly string[]): Readonly<{
    assertUnchanged: () => void;
    snapshots: readonly Readonly<{
        root: string;
        sessionId: string;
        fileHash: string;
        executionProtected: boolean;
        hasCompoundLedger: boolean;
        hasSemanticLedger: boolean;
        hasObservationClosure: boolean;
        hasUnsettledExecution: boolean;
    }>[];
    unclassifiedEntries: readonly string[];
    bytesRead: number;
    entriesRead: number;
    digest: string;
}> & CompoundSourceInventory;
export {};
