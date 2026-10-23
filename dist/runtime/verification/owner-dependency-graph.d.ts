import type { Database } from 'better-sqlite3';
/** Private same-database graph; serialized edges confer no authority. */
export declare function createOwnerDependencyGraph(db: Database): Readonly<{
    descendants: (key: string) => string[];
    ancestors: (key: string) => string[];
}>;
