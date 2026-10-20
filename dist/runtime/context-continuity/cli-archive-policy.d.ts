import type { DatabaseSync } from 'node:sqlite';
/** Shared readonly policy for original main-claimed CLI archives, never live execution. */
export declare function assertCliArchiveSource(sourceId: string, options: {
    db: Pick<DatabaseSync, 'prepare'>;
    scope(id: string): 'readable' | 'blocked' | 'deleted';
}): void;
