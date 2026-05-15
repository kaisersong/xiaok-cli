// Stub — full implementation in Task 6
import type { MemoryStore, MemoryRecord, MemoryType } from './store.js';

export interface LayeredMemoryConfig {
  dbPath: string;
  embedding: {
    apiUrl: string;
    model: string;
    dimensions: number;
  };
  llm: {
    apiUrl: string;
    model: string;
    apiKey?: string;
  };
  compaction?: {
    l0MinMessages?: number;
    autoCompact?: boolean;
    compactIntervalMs?: number;
    maxPromptTokens?: number;
  };
}

export function resolveLayeredConfig(config: Record<string, unknown>): LayeredMemoryConfig {
  return config as unknown as LayeredMemoryConfig;
}

export class LayeredMemoryStore implements MemoryStore {
  constructor(_config: LayeredMemoryConfig) {
    throw new Error('LayeredMemoryStore not yet implemented — see Task 6');
  }

  async save(_record: MemoryRecord): Promise<void> {
    throw new Error('Not implemented');
  }

  async listRelevant(_input: { cwd: string; query: string; typeFilter?: MemoryType }): Promise<MemoryRecord[]> {
    throw new Error('Not implemented');
  }

  async search(_query: string, _limit?: number): Promise<MemoryRecord[]> {
    throw new Error('Not implemented');
  }

  async writeRawMessage(_sessionId: string, _role: string, _content: string): Promise<void> {
    throw new Error('Not implemented');
  }

  close(): void {}
}
