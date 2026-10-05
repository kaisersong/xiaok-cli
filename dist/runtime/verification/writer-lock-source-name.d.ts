/** Classifies only the original lock-file namespace. Membership in the full
 * original inventory and an empty held SQLite schema are separate checks. */
export declare function isWriterLockSourceName(directory: string, basename: string): boolean;
