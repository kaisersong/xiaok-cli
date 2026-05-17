import Database from 'better-sqlite3';
export declare function getSchemaVersion(db: Database.Database): number;
export declare function runMigrations(db: Database.Database): void;
