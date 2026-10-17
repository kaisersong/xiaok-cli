import { type OrdinaryProfileSourceInput } from './ordinary-profile-source-registry.js';
/** Routing check only: no source completeness, ownership or custody grant. */
export declare function assertOrdinarySourceWriterRoute(): void;
/** Original directory writer discovery only; this grants no protected writer
 * or source custody. The caller must retain its own original mutation lock. */
export declare function observeOrdinaryDirectoryWriter(path: string, kind: Exclude<OrdinaryProfileSourceInput['kind'], 'sqlite-db'>): void;
/** Called after the original SQLite open and before its first schema/data write.
 * Windows ordinary absence is verified first; its POSIX inventory stays unknown. */
export declare function observeOrdinarySQLiteWriter(path: string, snapshotFormat: Extract<OrdinaryProfileSourceInput, {
    kind: 'sqlite-db';
}>['snapshotFormat']): void;
