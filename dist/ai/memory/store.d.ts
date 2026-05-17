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
export interface LayerEntry {
    id: string;
    content: string;
    tags?: string[];
    createdAt?: string;
    meta?: Record<string, unknown>;
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
    compact?(): Promise<void>;
    getStats?(): {
        l0: number;
        l1: number;
        l2: number;
        l3: number;
        dbSizeBytes: number;
    };
    getPersonaTraits?(): {
        trait: string;
        confidence: number;
    }[];
    clearAll?(): void;
    setLLMFn?(fn: (prompt: string) => Promise<string>): void;
    delete?(id: string, layer?: number): Promise<boolean>;
    listLayer?(layer: number, limit?: number, offset?: number): LayerEntry[];
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
export declare function createMemoryStoreAsync(config?: Record<string, unknown>): Promise<MemoryStore>;
