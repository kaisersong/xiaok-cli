import Database from 'better-sqlite3';
import { EmbeddingClient } from './embedding.js';
export interface SearchOptions {
    bm25Weight?: number;
    vectorWeight?: number;
    rrfK?: number;
    limit?: number;
    layers?: number[];
}
export interface SearchResult {
    id: string;
    layer: number;
    content: string;
    score: number;
    metadata: Record<string, unknown>;
}
export declare function hybridSearch(db: Database.Database, embeddingClient: EmbeddingClient, query: string, options?: SearchOptions): Promise<SearchResult[]>;
