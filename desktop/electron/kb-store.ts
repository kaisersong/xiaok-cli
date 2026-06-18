/**
 * Knowledge Base — Store Interface
 *
 * Defines the contract for KB persistence (knowledge.db).
 * Implementation in PR-A; this file is the contract for PR0 tests.
 */

import type {
  Collection,
  CollectionState,
  Chunk,
  CreateCollectionInput,
  GetSourceOutput,
  KbSearchInput,
  KbSearchResult,
  Source,
  AddSourceInput,
  SourceEmbeddingProgress,
} from './kb-types.js';

export interface KbStore {
  _db?: unknown;
  // Collection CRUD
  createCollection(input: CreateCollectionInput): Collection;
  getCollection(id: string): Collection | undefined;
  listCollections(): Collection[];
  renameCollection(id: string, name: string, description?: string): Collection | undefined;
  deleteCollection(id: string): void;

  // Source CRUD
  addSource(input: AddSourceInput): Source;
  getSource(id: string): Source | undefined;
  listSources(collectionId: string): Source[];
  deleteSource(id: string): void;
  retrySource(id: string): Source | undefined;
  getSourceEmbeddingProgress(sourceId: string): SourceEmbeddingProgress;

  // Chunk operations
  insertChunks(sourceId: string, chunks: Array<{ idx: number; text: string; charStart: number; charEnd: number; pageIndex?: number; slideIndex?: number; sheetName?: string; cellRange?: string }>): Chunk[];
  listChunks(sourceId: string): Chunk[];
  markChunkEmbedded(chunkId: string): void;
  markChunkFailed(chunkId: string, error: string): void;

  // Aggregated views
  getCollectionState(collectionId: string): CollectionState | undefined;
  getSourceWithContent(sourceId: string, offset?: number, limit?: number): GetSourceOutput | undefined;

  close(): void;
}

export interface SourceExtractor {
  extract(input: { filePath: string; mimeType: string }): Promise<SourceExtractionResult>;
  extractFromUrl(url: string): Promise<SourceExtractionResult>;
  extractFromText(text: string, title: string): SourceExtractionResult;
}

export interface SourceExtractionResult {
  ok: boolean;
  text?: string;
  mimeType?: string;
  error?: string;
  pageCount?: number;
}

export interface ChunkerInput {
  text: string;
  mimeType?: string;
  pageBreaks?: number[];
  slideBreaks?: number[];
  sheetBreaks?: Array<{ name: string; charStart: number }>;
}

export interface ChunkOutput {
  idx: number;
  text: string;
  charStart: number;
  charEnd: number;
  pageIndex?: number;
  slideIndex?: number;
  sheetName?: string;
  cellRange?: string;
}

export interface Chunker {
  chunk(input: ChunkerInput): ChunkOutput[];
}

export interface KbRetriever {
  search(input: KbSearchInput): Promise<KbSearchResult[]>;
}
