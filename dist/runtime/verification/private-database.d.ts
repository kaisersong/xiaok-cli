import type { Database } from 'better-sqlite3';
/** Only the actual no-verbose private opener mints this code/data-access context. No authority is supplied. */
export declare function readPrivateDatabaseNativeAccess(db: Database): Readonly<{
    cpp: object;
    symbol: symbol;
    prepare: Function;
    open: Function;
    statement: Readonly<Record<string, Function>>;
    databasePrototype: object;
    cppPrototype: object;
    statementPrototype: object;
    fingerprints: readonly Readonly<{
        target: object;
        key: PropertyKey;
        descriptor: PropertyDescriptor | undefined;
    }>[];
}> | undefined;
/** Bounded private storage, not evidence that its enclosing OS identity is qualified. */
export declare function openPrivateVerificationDatabase(inputRoot: string): Database;
