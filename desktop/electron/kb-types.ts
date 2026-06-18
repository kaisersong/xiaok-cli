/**
 * Knowledge Base — Core Type Definitions
 *
 * This module defines the domain types for the KB system:
 * Collection, Source, Chunk, and related enums/inputs.
 * The KB is desktop-only and stored in a separate knowledge.db.
 */

export type CollectionScope = 'global' | 'project';
export type SourceKind = 'file' | 'url' | 'paste';
export type SourceParseStatus = 'pending' | 'parsing' | 'parsed' | 'failed' | 'unsupported';
export type ChunkEmbeddingStatus = 'pending' | 'embedding' | 'embedded' | 'failed';

export interface Collection {
  id: string;
  name: string;
  description: string;
  color: string;
  scope: CollectionScope;
  cwd: string;
  embeddingModelId: string;
  embeddingDim: number;
  chunkCountCached: number;
  autoAcceptWebPersist: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface Source {
  id: string;
  collectionId: string;
  kind: SourceKind;
  title: string;
  uri: string;
  mimeType: string;
  sha256: string;
  byteSize: number;
  rawPath: string;
  extractedTextPath: string;
  parseStatus: SourceParseStatus;
  parseError: string;
  parseAttempts: number;
  chunkCount: number;
  metadata: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export interface Chunk {
  id: string;
  sourceId: string;
  collectionId: string;
  idx: number;
  text: string;
  charStart: number;
  charEnd: number;
  pageIndex: number | null;
  slideIndex: number | null;
  sheetName: string | null;
  cellRange: string | null;
  embeddingStatus: ChunkEmbeddingStatus;
  embeddingError: string;
  metadata: Record<string, unknown>;
  createdAt: number;
}

export interface CreateCollectionInput {
  name: string;
  description?: string;
  color?: string;
  scope?: CollectionScope;
  cwd?: string;
  embeddingModelId: string;
  embeddingDim: number;
}

export interface AddSourceInput {
  collectionId: string;
  kind: SourceKind;
  title: string;
  uri?: string;
  filePath?: string;
  text?: string;
}

export interface KbSearchInput {
  query: string;
  collectionId: string;
  sourceIds?: string[];
  topK?: number;
}

export interface KbSearchResult {
  chunkId: string;
  sourceId: string;
  sourceTitle: string;
  collectionId: string;
  text: string;
  pageIndex: number | null;
  slideIndex: number | null;
  sheetName: string | null;
  bm25Score: number;
  vectorScore: number;
  fusedScore: number;
}

export interface GetSourceOutput {
  source: Source;
  outline: Array<{
    kind: 'page' | 'slide' | 'sheet' | 'section';
    index: number;
    title?: string;
    charStart: number;
    charEnd: number;
  }>;
  text: string;
  hasMore: boolean;
  nextOffset?: number;
  totalChars: number;
}

export interface SourceEmbeddingProgress {
  embedded: number;
  total: number;
  failed: number;
}

export interface CollectionState {
  collection: Collection;
  sources: Array<{
    id: string;
    title: string;
    parseStatus: SourceParseStatus;
    embeddingProgress: SourceEmbeddingProgress;
  }>;
}
