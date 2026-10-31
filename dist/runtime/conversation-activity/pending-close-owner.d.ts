/** Local close ownership only: no SDK brand, actor or authorization. */
export interface PendingCloseOwner<T extends {
    close(): Promise<void>;
}> {
    readonly settled: Promise<T>;
    close(): Promise<void>;
}
/** The actual caller supplies its ONE already-started public producer Promise. */
export declare function ownPendingClose<T extends {
    close(): Promise<void>;
}>(settled: Promise<T>): PendingCloseOwner<T>;
