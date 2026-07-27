import type { PersistedSessionSnapshot, SessionListEntry, SessionStore } from './store.js';
export declare class FileSessionStore implements SessionStore {
    private readonly rootDir;
    constructor(rootDir?: string);
    createSessionId(): string;
    save(snapshot: PersistedSessionSnapshot): Promise<void>;
    loadLast(): Promise<PersistedSessionSnapshot | null>;
    load(sessionId: string): Promise<PersistedSessionSnapshot | null>;
    list(): Promise<SessionListEntry[]>;
    fork(sessionId: string): Promise<PersistedSessionSnapshot>;
    private readSnapshot;
    private getFilePath;
    private ensureRoot;
}
export declare function createFileSessionStore(rootDir?: string): FileSessionStore;
