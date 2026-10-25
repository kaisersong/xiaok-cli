export interface CompoundHostStorage {
    readonly configRoot: string;
    readonly canonicalRoot: string;
    readonly sourceRoots: readonly string[];
}
/** Host configuration routing only, not a user grant, legacy-drain proof, or a
 * durable root registration. No path is accepted from policy or model input.
 * Existing durable registered roots must be supplied by the host registry; the
 * fixed CLI/Desktop roots are always included and cannot be replaced. */
export declare function resolveCompoundHostStorage(input: {
    configRoot: string;
    desktopDataRoot?: string;
    registeredSourceRoots?: readonly string[];
}): Readonly<CompoundHostStorage>;
/** Inspects the exact host layout. A copied DTO cannot omit mandatory roots.
 * The report remains inspection evidence, never authorization to discard old
 * execution state or to activate a new domain. */
export declare function inspectCompoundHostSources(layout: CompoundHostStorage): Readonly<{
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
}> & import("./compound-source-inventory.js").CompoundSourceInventory;
export declare function assertCompoundHostStorage(layout: CompoundHostStorage): Readonly<CompoundHostStorage>;
