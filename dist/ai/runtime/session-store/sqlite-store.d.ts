import type { Message } from '../../../types.js';
import type { PersistedSessionSnapshot, SessionListEntry, SessionStore } from './store.js';
export interface SessionMessageSearchHit {
    sessionId: string;
    messageIndex: number;
    role: Message['role'];
    textContent: string;
}
export declare class SQLiteSessionStore implements SessionStore {
    private readonly db;
    constructor(dbPath: string);
    createSessionId(): string;
    save(snapshot: PersistedSessionSnapshot): Promise<void>;
    loadLast(): Promise<PersistedSessionSnapshot | null>;
    load(sessionId: string): Promise<PersistedSessionSnapshot | null>;
    list(): Promise<SessionListEntry[]>;
    fork(sessionId: string): Promise<PersistedSessionSnapshot>;
    searchMessages(query: string, limit?: number): SessionMessageSearchHit[];
    dispose(): void;
}
