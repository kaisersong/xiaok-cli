import Database from 'better-sqlite3';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as crypto from 'node:crypto';
import type { MemoryStore, MemoryRecord, MemoryType } from './store.js';
import { runMigrations } from './migrations.js';
import { EmbeddingClient, type EmbeddingConfig } from './embedding.js';
import { hybridSearch } from './retrieval.js';
import { compactL0toL1, compactL1toL2, compactL2toL3 } from './compaction.js';
import { segmentChinese } from './segment.js';

export interface LayeredMemoryConfig {
  dbPath: string;
  embedding: EmbeddingConfig;
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
  const c = config as Record<string, any>;
  return {
    dbPath: c.dbPath ?? path.join(process.env.HOME || '/tmp', '.xiaok', 'memory.db'),
    embedding: {
      apiUrl: c.embedding?.apiUrl ?? 'http://localhost:11434/v1',
      model: c.embedding?.model ?? 'nomic-embed-text',
      dimensions: c.embedding?.dimensions ?? 768,
    },
    llm: {
      apiUrl: c.llm?.apiUrl ?? 'http://localhost:11434/v1',
      model: c.llm?.model ?? 'qwen2.5',
      apiKey: c.llm?.apiKey,
    },
    compaction: {
      l0MinMessages: c.compaction?.l0MinMessages ?? 5,
      autoCompact: c.compaction?.autoCompact ?? false,
      compactIntervalMs: c.compaction?.compactIntervalMs ?? 60000,
      maxPromptTokens: c.compaction?.maxPromptTokens ?? 8000,
    },
  };
}

export class LayeredMemoryStore implements MemoryStore {
  private db: Database.Database;
  private embeddingClient: EmbeddingClient;
  private llmConfig: { apiUrl: string; model: string; apiKey?: string };
  private compactionConfig: {
    l0MinMessages: number;
    autoCompact: boolean;
    compactIntervalMs: number;
    maxPromptTokens: number;
  };
  private compactTimer?: ReturnType<typeof setInterval>;
  private compacting = false;

  constructor(config: LayeredMemoryConfig) {
    const dir = path.dirname(config.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(config.dbPath);
    runMigrations(this.db);

    this.embeddingClient = new EmbeddingClient(this.db, config.embedding);
    this.llmConfig = config.llm;
    this.compactionConfig = {
      l0MinMessages: config.compaction?.l0MinMessages ?? 5,
      autoCompact: config.compaction?.autoCompact ?? false,
      compactIntervalMs: config.compaction?.compactIntervalMs ?? 60000,
      maxPromptTokens: config.compaction?.maxPromptTokens ?? 8000,
    };

    if (this.compactionConfig.autoCompact) {
      this.startAutoCompact();
    }
  }

  async save(record: MemoryRecord): Promise<void> {
    const id = record.id || crypto.randomUUID();
    const segmented = segmentChinese(record.title + ' ' + record.summary);
    const scope = record.scope || 'global';
    const cwd = record.cwd || null;
    const memType = record.type || null;

    this.db.prepare(
      `INSERT OR REPLACE INTO memory_l0_raw (id, session_id, role, content, segmented_content, scope, mem_type, cwd)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, cwd || 'manual', 'user', record.summary, segmented, scope, memType, cwd);

    this.db.prepare(
      `INSERT OR REPLACE INTO memory_l1_extracted (id, source_ids, summary, tags, scope, mem_type, cwd)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(id, JSON.stringify([id]), record.title, JSON.stringify(record.tags || []), scope, memType, cwd);

    this.embeddingClient.embedAndStore(id, 1, `${record.title} ${record.summary}`).catch(() => {});
  }

  async listRelevant(input: { cwd: string; query: string; typeFilter?: MemoryType }): Promise<MemoryRecord[]> {
    const results = await hybridSearch(this.db, this.embeddingClient, input.query, { limit: 20 });

    return results
      .map(r => this.searchResultToRecord(r))
      .filter(r => {
        if (r.scope === 'project' && r.cwd !== input.cwd) return false;
        if (input.typeFilter && r.type !== input.typeFilter) return false;
        return true;
      });
  }

  async search(query: string, limit: number = 10): Promise<MemoryRecord[]> {
    const results = await hybridSearch(this.db, this.embeddingClient, query, { limit });
    return results.map(r => this.searchResultToRecord(r));
  }

  async writeRawMessage(sessionId: string, role: string, content: string): Promise<void> {
    const id = crypto.randomUUID();
    const segmented = segmentChinese(content);
    this.db.prepare(
      `INSERT INTO memory_l0_raw (id, session_id, role, content, segmented_content) VALUES (?, ?, ?, ?, ?)`
    ).run(id, sessionId, role, content, segmented);
  }

  async compact(): Promise<void> {
    if (this.compacting) return;
    this.compacting = true;
    try {
      const llm = this.createLLMFn();
      const r1 = await compactL0toL1(this.db, llm, {
        minMessages: this.compactionConfig.l0MinMessages,
        maxPromptTokens: this.compactionConfig.maxPromptTokens,
      });
      if (r1.extracted > 0) {
        const r2 = await compactL1toL2(this.db, llm);
        if (r2.scenarios > 0) {
          await compactL2toL3(this.db, llm);
        }
      }
    } finally {
      this.compacting = false;
    }
  }

  getPersonaTraits(): { trait: string; confidence: number }[] {
    const rows = this.db.prepare(
      'SELECT trait, confidence FROM memory_l3_persona ORDER BY confidence DESC'
    ).all() as any[];
    return rows.map(r => ({ trait: r.trait, confidence: r.confidence }));
  }

  getLayerCount(layer: number): number {
    const tableMap: Record<number, string> = {
      0: 'memory_l0_raw',
      1: 'memory_l1_extracted',
      2: 'memory_l2_scenario',
      3: 'memory_l3_persona',
    };
    const table = tableMap[layer];
    if (!table) return 0;
    const row = this.db.prepare(`SELECT COUNT(*) as count FROM ${table}`).get() as any;
    return row.count;
  }

  close(): void {
    if (this.compactTimer) {
      clearInterval(this.compactTimer);
    }
    this.db.close();
  }

  private searchResultToRecord(r: { id: string; layer: number; content: string; metadata: Record<string, unknown> }): MemoryRecord {
    const meta = r.metadata as {
      cwd?: string;
      mem_type?: MemoryType;
      scope?: 'global' | 'project';
      tags?: string[];
    };
    return {
      id: r.id,
      scope: meta?.scope || 'global',
      cwd: meta?.cwd,
      title: r.content.slice(0, 80),
      summary: r.content,
      tags: meta?.tags || [],
      type: meta?.mem_type,
      updatedAt: Date.now(),
    };
  }

  private startAutoCompact(): void {
    this.compactTimer = setInterval(() => {
      this.compact().catch(err => {
        console.error('[memory] auto-compaction failed:', (err as Error).message);
      });
    }, this.compactionConfig.compactIntervalMs);
  }

  private createLLMFn(): (prompt: string) => Promise<string> {
    const cfg = this.llmConfig;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (cfg.apiKey) {
      headers['Authorization'] = `Bearer ${cfg.apiKey}`;
    }

    return async (prompt: string) => {
      const resp = await fetch(`${cfg.apiUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: cfg.model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.3,
        }),
      });

      if (!resp.ok) {
        throw new Error(`LLM API error: ${resp.status}`);
      }

      const data = await resp.json() as any;
      return data.choices[0].message.content;
    };
  }
}
