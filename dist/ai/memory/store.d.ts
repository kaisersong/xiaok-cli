export type MemoryType = 'user' | 'feedback' | 'project' | 'reference';
export interface MemoryRecord {
    id: string;
    scope: 'global' | 'project';
    cwd?: string;
    title: string;
    summary: string;
    tags: string[];
    updatedAt: number;
    type?: MemoryType;
}
export interface MemoryStore {
    save(record: MemoryRecord): Promise<void>;
    listRelevant(input: {
        cwd: string;
        query: string;
        typeFilter?: MemoryType;
    }): Promise<MemoryRecord[]>;
    search?(query: string, limit?: number): Promise<MemoryRecord[]>;
    writeRawMessage?(sessionId: string, role: string, content: string): Promise<void>;
    close?(): void;
}
export declare class FileMemoryStore implements MemoryStore {
    private readonly rootDir;
    constructor(rootDir?: string);
    save(record: MemoryRecord): Promise<void>;
    listRelevant(input: {
        cwd: string;
        query: string;
        typeFilter?: MemoryType;
    }): Promise<MemoryRecord[]>;
}
export declare function createMemoryStoreAsync(config?: unknown): Promise<MemoryStore>;
