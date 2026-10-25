import type { Database } from 'better-sqlite3';
export interface SharedCapacityWriteContext {
    readonly __sharedCapacityWriteContext?: never;
}
export declare function inspectSharedCapacityCommand(command: object, ledger: object, database: Database): Readonly<{
    kind: "import";
    entries: {
        owner: import("./shared-capacity-ledger.js").CapacityOwner;
        proposal: import("./shared-capacity-ledger.js").CapacityProposal;
    }[];
}> | Readonly<{
    kind: "transaction";
}> | Readonly<{
    kind: "batch";
    entries: readonly {
        owner: import("./shared-capacity-ledger.js").CapacityOwner;
        proposal: import("./shared-capacity-ledger.js").CapacityProposal;
    }[];
}> | Readonly<{
    owner: import("./shared-capacity-ledger.js").CapacityOwner;
    proposal: import("./shared-capacity-ledger.js").CapacityProposal;
    kind: "release" | "reserve" | "unallocated-release";
    receipt: object | undefined;
}>;
export declare function executeSharedCapacityCommand(command: object, context: SharedCapacityWriteContext): void;
