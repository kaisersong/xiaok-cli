import type Database from 'better-sqlite3';
export declare const SESSION_STORE_SCHEMA_VERSION = 2;
export declare function applySessionStoreSchema(db: Database.Database): void;
