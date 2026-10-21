import type Database from 'better-sqlite3';
import { type IntentContractEnrollment } from './intent-contract-enrollment.js';
/** Internal call sites must be synchronous; nested calls get independent caches. */
export declare function withIntentSqlParsingContext<T>(db: Database.Database, fn: () => T): T;
/** Decode the freshly read SQL text; cache only an original-parser accepted body. */
export declare function readIntentSqlContract(db: Database.Database, raw: string): Readonly<IntentContractEnrollment>;
