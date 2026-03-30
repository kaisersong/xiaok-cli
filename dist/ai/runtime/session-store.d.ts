import type { Message, UsageStats } from '../../types.js';
export interface PersistedSessionSnapshot {
    sessionId: string;
    cwd: string;
    model?: string;
    createdAt: number;
    updatedAt: number;
    forkedFromSessionId?: string;
    messages: Message[];
    usage: UsageStats;
}
export interface SessionListEntry {
    sessionId: string;
    cwd: string;
    updatedAt: number;
    preview: string;
}
export declare class FileSessionStore {
    private readonly rootDir;
    constructor(rootDir?: string);
    createSessionId(): string;
    save(snapshot: PersistedSessionSnapshot): Promise<void>;
    load(sessionId: string): Promise<PersistedSessionSnapshot | null>;
    list(): Promise<SessionListEntry[]>;
    fork(sessionId: string): Promise<PersistedSessionSnapshot>;
    private getFilePath;
}
