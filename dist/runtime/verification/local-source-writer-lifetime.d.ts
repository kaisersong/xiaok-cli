/** Local call bookkeeping only. This helper issues no native custody, approval,
 * owner or capacity capability; actual stores keep their lifetimes private. */
export declare function createLocalSourceWriterLifetime(errorPrefix: string): Readonly<{
    runAsync<T>(work: () => Promise<T>): Promise<T>;
    runSync<T>(work: () => T): T;
    close(): Promise<void>;
}>;
