

export interface KbCollection {
  id: string;
  name: string;
  description: string;
  color: string;
  chunkCountCached: number;
  createdAt: number;
  updatedAt: number;
}

export interface KbSource {
  id: string;
  collectionId: string;
  kind: 'file' | 'url' | 'paste' | 'meeting';
  title: string;
  uri: string;
  parseStatus: string;
  chunkCount: number;
  createdAt: number;
}

export interface KbSearchResult {
  chunkId: string;
  sourceId: string;
  sourceTitle: string;
  text: string;
  pageIndex: number | null;
  fusedScore: number;
}

export interface KbSourceContent {
  source: KbSource;
  text: string;
  hasMore: boolean;
  totalChars: number;
}
