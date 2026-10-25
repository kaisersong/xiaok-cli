import type { Database } from 'better-sqlite3';
/** Byte check for the shared control database. Whole-profile/archive reservation is a separate owner. */
export declare function assertVerificationDatabaseBudget(db: Database, options: {
    additionalBytes: number;
    limitBytes?: number;
}): void;
export declare function runVerificationTransaction<T>(db: Database, work: () => T): T;
