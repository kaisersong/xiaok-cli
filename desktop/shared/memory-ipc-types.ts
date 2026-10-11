/** Desktop memory wire DTOs; main owns persistence and source authority. */
export interface MemoryIpcEntry { id: string; content: string; tags: string[]; createdAt: number }
export interface MemoryImportIpcResult { imported: number; deduped: number; parseErrors: string[] }
export interface MemoryStatsIpcSnapshot { l0: number; l1: number; l2: number; l3: number; dbSizeBytes: number }
export interface MemoryPersonaIpcTrait { trait: string; confidence: number }
/** The four concrete LayeredMemoryStore.listLayer producer shapes. */
export interface MemoryLayerIpcMeta {
  role?: string; sessionId?: string; scope?: string; type?: string | null;
  keyFacts?: string[]; evidence?: string[]; confidence?: number;
}
export interface MemoryLayerIpcEntry { id: string; content: string; tags?: string[]; createdAt?: string; meta?: MemoryLayerIpcMeta }
export interface EmbeddingModelIpcEntry {
  id: string; name: string; dims: number; size: string; languages: string; downloaded: boolean; active: boolean;
  manualHint: { urls: Array<{ file: string; url: string }>; targetDir: string };
}
