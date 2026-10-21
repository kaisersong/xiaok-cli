import { type SessionDeletionJournal } from './file-session-parser.js';
import { type SessionMigrationMarker } from './migration.js';
import type { CompoundDeletionBudget } from './compound-deletion-census.js';
import type { StoredSessionSnapshot } from './store.js';
export declare class FileSessionReader {
    private readonly rootDir;
    constructor(rootDir?: string);
    load(sessionId: string): Promise<StoredSessionSnapshot | null>;
    loadSync(sessionId: string): StoredSessionSnapshot | null;
    readSessionSnapshot(sessionId: string, preserveIntent?: boolean): StoredSessionSnapshot | null;
    getFilePath(sessionId: string): string;
    migrationPath(sessionId: string): string;
    readSessionMigration(sessionId: string): SessionMigrationMarker | null;
    deletionDirectory(): string;
    readDeletionJournal(sessionId: string, budget?: CompoundDeletionBudget): SessionDeletionJournal | undefined;
    loadSessionAliasSync(holder: {
        holderRoot: string;
        holderId: string;
    }): {
        binding: import("./aliases.js").SessionAliasBinding;
        snapshot: StoredSessionSnapshot;
    } | null;
}
