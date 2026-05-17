import type { MemoryStore, MemoryRecord, MemoryType } from './store.js';
import type { ModelAdapter } from '../../types.js';
import { type EmbeddingConfig } from './embedding.js';
export interface LayeredMemoryConfig {
    dbPath: string;
    embedding?: Partial<EmbeddingConfig>;
    compaction?: {
        l0MinMessages?: number;
        autoCompact?: boolean;
        compactIntervalMs?: number;
        maxPromptTokens?: number;
    };
}
export declare function resolveLayeredConfig(config?: Record<string, unknown>): LayeredMemoryConfig;
/**
 * Create an LLM function from a ModelAdapter, following the CompactRunner pattern.
 */
export declare function createLLMFromAdapter(adapter: ModelAdapter): (prompt: string) => Promise<string>;
export declare class LayeredMemoryStore implements MemoryStore {
    private db;
    private dbPath;
    private embeddingClient;
    private llmFn?;
    private compactionConfig;
    private compactTimer?;
    private compacting;
    constructor(config: LayeredMemoryConfig);
    setLLMFn(fn: (prompt: string) => Promise<string>): void;
    save(record: MemoryRecord): Promise<void>;
    listRelevant(input: {
        cwd: string;
        query: string;
        typeFilter?: MemoryType;
    }): Promise<MemoryRecord[]>;
    search(query: string, limit?: number): Promise<MemoryRecord[]>;
    writeRawMessage(sessionId: string, role: string, content: string): Promise<void>;
    compact(): Promise<void>;
    delete(id: string, layer?: number): Promise<boolean>;
    getPersonaTraits(): {
        trait: string;
        confidence: number;
    }[];
    getStats(): {
        l0: number;
        l1: number;
        l2: number;
        l3: number;
        dbSizeBytes: number;
    };
    getLayerCount(layer: number): number;
    listLayer(layer: number, limit?: number, offset?: number): Array<{
        id: string;
        content: string;
        createdAt?: string;
        tags?: string[];
        meta?: Record<string, unknown>;
    }>;
    clearAll(): void;
    listUserMemories(limit?: number): Array<{
        id: string;
        content: string;
        tags: string[];
        createdAt: number;
        source?: string;
    }>;
    createUserMemory(input: {
        content: string;
        tags: string[];
        source?: string;
    }): {
        id: string;
        content: string;
        tags: string[];
        createdAt: number;
        source?: string;
    };
    updateUserMemory(id: string, input: {
        content?: string;
        tags?: string[];
    }): {
        id: string;
        content: string;
        tags: string[];
    } | null;
    deleteUserMemory(id: string): boolean;
    close(): void;
    private searchResultToRecord;
    private startAutoCompact;
}
