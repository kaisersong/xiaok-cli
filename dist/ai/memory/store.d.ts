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
export declare class FileMemoryStore {
    private readonly rootDir;
    constructor(rootDir?: string);
    save(record: MemoryRecord): Promise<void>;
    listRelevant(input: {
        cwd: string;
        query: string;
        typeFilter?: MemoryType;
    }): Promise<MemoryRecord[]>;
}
