import Database from 'better-sqlite3';
export interface EmbeddingConfig {
    provider: 'local' | 'api';
    apiUrl: string;
    model: string;
    dimensions: number;
}
export declare class EmbeddingClient {
    private db;
    private config;
    private cache;
    private onnxEngine;
    private onnxStatus;
    constructor(db: Database.Database, config: EmbeddingConfig);
    private cacheKey;
    embed(text: string): Promise<Float32Array>;
    private persistEmbedding;
    embedBatch(texts: string[]): Promise<Float32Array[]>;
    embedAndStore(memoryId: string, layer: number, text: string): Promise<Float32Array>;
    getStoredEmbedding(memoryId: string, layer: number): Float32Array | null;
    private callEmbedApi;
    close(): Promise<void>;
}
