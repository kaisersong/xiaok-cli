export interface MemoryRecord {
    id: string;
    scope: 'global' | 'project';
    cwd?: string;
    title: string;
    summary: string;
    tags: string[];
    updatedAt: number;
}
export declare class FileMemoryStore {
    private readonly rootDir;
    constructor(rootDir?: string);
    save(record: MemoryRecord): Promise<void>;
    listRelevant(input: {
        cwd: string;
        query: string;
    }): Promise<MemoryRecord[]>;
}
