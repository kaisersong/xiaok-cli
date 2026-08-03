import type { PersistedSessionSnapshot, SessionListEntry, SessionStore } from './store.js';
import { type AtomicWriteFile } from '../../../utils/atomic-file.js';
export declare class FileSessionStore implements SessionStore {
    private readonly rootDir;
    private readonly atomicWrite;
    constructor(rootDir?: string, atomicWrite?: AtomicWriteFile);
    createSessionId(): string;
    save(snapshot: PersistedSessionSnapshot): Promise<void>;
    loadLast(): Promise<PersistedSessionSnapshot | null>;
    load(sessionId: string): Promise<PersistedSessionSnapshot | null>;
    list(): Promise<SessionListEntry[]>;
    fork(sessionId: string): Promise<PersistedSessionSnapshot>;
    private readSnapshot;
    private getFilePath;
    private ensureRoot;
    private readSnapshots;
}
export declare function createFileSessionStore(rootDir?: string): FileSessionStore;
