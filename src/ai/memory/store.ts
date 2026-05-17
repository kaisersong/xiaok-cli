import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getConfigDir } from '../../utils/config.js';

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

export interface LayerEntry {
  id: string;
  content: string;
  tags?: string[];
  createdAt?: string;
  meta?: Record<string, unknown>;
}

export interface MemoryStore {
  save(record: MemoryRecord): Promise<void>;
  listRelevant(input: { cwd: string; query: string; typeFilter?: MemoryType }): Promise<MemoryRecord[]>;
  search?(query: string, limit?: number): Promise<MemoryRecord[]>;
  writeRawMessage?(sessionId: string, role: string, content: string): Promise<void>;
  close?(): void;
  compact?(): Promise<void>;
  getStats?(): { l0: number; l1: number; l2: number; l3: number; dbSizeBytes: number };
  getPersonaTraits?(): { trait: string; confidence: number }[];
  clearAll?(): void;
  setLLMFn?(fn: (prompt: string) => Promise<string>): void;
  delete?(id: string, layer?: number): Promise<boolean>;
  listLayer?(layer: number, limit?: number, offset?: number): LayerEntry[];
}

export class FileMemoryStore implements MemoryStore {
  constructor(private readonly rootDir = join(getConfigDir(), 'memory')) {}

  async save(record: MemoryRecord): Promise<void> {
    await mkdir(this.rootDir, { recursive: true });
    await writeFile(join(this.rootDir, `${record.id}.json`), JSON.stringify(record, null, 2) + '\n', 'utf8');
  }

  async listRelevant(input: { cwd: string; query: string; typeFilter?: MemoryType }): Promise<MemoryRecord[]> {
    if (!existsSync(this.rootDir)) {
      return [];
    }

    const files = (await readdir(this.rootDir)).filter((entry) => entry.endsWith('.json'));
    const records = await Promise.all(
      files.map(async (entry) => JSON.parse(await readFile(join(this.rootDir, entry), 'utf8')) as MemoryRecord),
    );

    return records
      .filter((record) => record.scope === 'global' || record.cwd === input.cwd)
      .filter((record) => !input.typeFilter || record.type === input.typeFilter)
      .sort((left, right) => {
        const leftMatches = Number(
          left.title.includes(input.query)
          || left.summary.includes(input.query)
          || left.tags.some((tag) => tag.includes(input.query)),
        );
        const rightMatches = Number(
          right.title.includes(input.query)
          || right.summary.includes(input.query)
          || right.tags.some((tag) => tag.includes(input.query)),
        );
        return rightMatches - leftMatches || right.updatedAt - left.updatedAt;
      });
  }
}

export async function createMemoryStoreAsync(config?: Record<string, unknown>): Promise<MemoryStore> {
  // Explicit file mode bypasses layered store
  if (config?.type === 'file') {
    return new FileMemoryStore();
  }

  try {
    const { LayeredMemoryStore, resolveLayeredConfig } = await import('./layered-store.js');
    const resolved = resolveLayeredConfig(config);
    return new LayeredMemoryStore(resolved);
  } catch (err) {
    console.warn('[memory] Failed to initialize layered store, falling back to file store:', (err as Error).message);
    return new FileMemoryStore();
  }
}
