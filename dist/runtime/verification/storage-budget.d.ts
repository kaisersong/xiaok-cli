import type { Database } from 'better-sqlite3';
export declare function isVerificationHeadroomNotReady(error: unknown, database: Database): boolean;
/** Byte check for the shared control database. Whole-profile/archive reservation is a separate owner. */
export declare function assertVerificationDatabaseBudget(db: Database, options: {
    additionalBytes: number;
    limitBytes?: number;
}): void;
export declare function runVerificationTransaction<T>(db: Database, work: () => T): T;
