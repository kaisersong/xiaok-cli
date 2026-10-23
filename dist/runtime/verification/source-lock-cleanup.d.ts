/** Ordinary-UID recovery producer, using the original stale-lock algorithm.
 * Marker reconciliation is not custody, snapshot consistency or effect drain.
 * The installed parent derives these arguments from its approved private set. */
export declare function cleanupOriginalSourceLocks(args: readonly string[]): Readonly<{
    state: 'markers-reconciled';
    count: number;
}>;
