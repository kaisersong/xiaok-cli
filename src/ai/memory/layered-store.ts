import Database from 'better-sqlite3';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as crypto from 'node:crypto';
import type { MemoryStore, MemoryRecord, MemoryType } from './store.js';
import type { ModelAdapter, Message } from '../../types.js';
import { runMigrations } from './migrations.js';
import { EmbeddingClient, type EmbeddingConfig } from './embedding.js';
import { hybridSearch } from './retrieval.js';
import { compactL0toL1, compactL1toL2, compactL2toL3 } from './compaction.js';
import { segmentChinese } from './segment.js';
import { MODEL_REGISTRY } from './model-registry.js';

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

export function resolveLayeredConfig(config?: Record<string, unknown>): LayeredMemoryConfig {
  const c = (config ?? {}) as Record<string, any>;
  const provider = c.embedding?.provider ?? 'local';
  const modelId = c.embedding?.model ?? 'all-MiniLM-L6-v2';
  const registryEntry = MODEL_REGISTRY.find(m => m.id === modelId);
  const defaultDims = provider === 'api' ? 768 : (registryEntry?.dims ?? 384);
  return {
    dbPath: c.dbPath ?? path.join(process.env.HOME || '/tmp', '.xiaok', 'memory.db'),
    embedding: {
      provider,
      apiUrl: c.embedding?.apiUrl ?? 'http://localhost:11434/v1',
      model: modelId,
      dimensions: c.embedding?.dimensions ?? defaultDims,
    },
    compaction: {
      l0MinMessages: c.compaction?.l0MinMessages ?? 5,
      autoCompact: c.compaction?.autoCompact ?? false,
      compactIntervalMs: c.compaction?.compactIntervalMs ?? 60000,
      maxPromptTokens: c.compaction?.maxPromptTokens ?? 8000,
    },
  };
}

/**
 * Create an LLM function from a ModelAdapter, following the CompactRunner pattern.
 */
export function createLLMFromAdapter(adapter: ModelAdapter): (prompt: string) => Promise<string> {
  return async (prompt: string) => {
    const messages: Message[] = [
      { role: 'user', content: [{ type: 'text', text: prompt }] },
    ];
    const chunks: string[] = [];
    for await (const chunk of adapter.stream(messages, [], '只输出JSON结果，不要其他内容。不要调用任何工具。')) {
      if (chunk.type === 'text') chunks.push(chunk.delta);
    }
    return chunks.join('');
  };
}

export class LayeredMemoryStore implements MemoryStore {
  private db: Database.Database;
  private dbPath: string;
  private embeddingClient: EmbeddingClient;
  private llmFn?: (prompt: string) => Promise<string>;
  private compactionConfig: {
    l0MinMessages: number;
    autoCompact: boolean;
    compactIntervalMs: number;
    maxPromptTokens: number;
  };
  private compactTimer?: ReturnType<typeof setInterval>;
  private compacting = false;

  constructor(config: LayeredMemoryConfig) {
    this.dbPath = config.dbPath;
    const dir = path.dirname(config.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(config.dbPath);
    runMigrations(this.db);

    const embeddingConfig: EmbeddingConfig = {
      provider: config.embedding?.provider ?? 'local',
      apiUrl: config.embedding?.apiUrl ?? 'http://localhost:11434/v1',
      model: config.embedding?.model ?? 'all-MiniLM-L6-v2',
      dimensions: config.embedding?.dimensions ?? 384,
    };
    this.embeddingClient = new EmbeddingClient(this.db, embeddingConfig);
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

  setLLMFn(fn: (prompt: string) => Promise<string>): void {
    this.llmFn = fn;
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
    if (!this.llmFn) {
      console.warn('[memory] compaction skipped: no LLM function configured. Call setLLMFn() first.');
      return;
    }
    this.compacting = true;
    try {
      const llm = this.llmFn;
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

  async delete(id: string, layer?: number): Promise<boolean> {
    if (layer !== undefined) {
      const tableMap: Record<number, string> = {
        0: 'memory_l0_raw',
        1: 'memory_l1_extracted',
        2: 'memory_l2_scenario',
        3: 'memory_l3_persona',
      };
      const table = tableMap[layer];
      if (!table) return false;
      const r = this.db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
      return r.changes > 0;
    }
    const r1 = this.db.prepare('DELETE FROM memory_l1_extracted WHERE id = ?').run(id);
    const r0 = this.db.prepare('DELETE FROM memory_l0_raw WHERE id = ?').run(id);
    return (r1.changes + r0.changes) > 0;
  }

  getPersonaTraits(): { trait: string; confidence: number }[] {
    const rows = this.db.prepare(
      'SELECT trait, confidence FROM memory_l3_persona ORDER BY confidence DESC'
    ).all() as any[];
    return rows.map(r => ({ trait: r.trait, confidence: r.confidence }));
  }

  getStats(): { l0: number; l1: number; l2: number; l3: number; dbSizeBytes: number } {
    const l0 = (this.db.prepare('SELECT COUNT(*) as c FROM memory_l0_raw').get() as any).c;
    const l1 = (this.db.prepare('SELECT COUNT(*) as c FROM memory_l1_extracted').get() as any).c;
    const l2 = (this.db.prepare('SELECT COUNT(*) as c FROM memory_l2_scenario').get() as any).c;
    const l3 = (this.db.prepare('SELECT COUNT(*) as c FROM memory_l3_persona').get() as any).c;
    let dbSizeBytes = 0;
    try { dbSizeBytes = fs.statSync(this.dbPath).size; } catch {}
    return { l0, l1, l2, l3, dbSizeBytes };
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

  listLayer(layer: number, limit = 50, offset = 0): Array<{ id: string | number; content: string; createdAt?: string; tags?: string[]; meta?: Record<string, unknown> }> {
    switch (layer) {
      case 0: {
        const rows = this.db.prepare(
          'SELECT id, role, content, session_id, created_at FROM memory_l0_raw ORDER BY created_at DESC LIMIT ? OFFSET ?'
        ).all(limit, offset) as any[];
        return rows.map(r => ({
          id: r.id,
          content: r.content,
          createdAt: r.created_at,
          meta: { role: r.role, sessionId: r.session_id },
        }));
      }
      case 1: {
        const rows = this.db.prepare(
          'SELECT id, summary, tags, scope, mem_type, created_at FROM memory_l1_extracted ORDER BY created_at DESC LIMIT ? OFFSET ?'
        ).all(limit, offset) as any[];
        return rows.map(r => ({
          id: r.id,
          content: r.summary,
          tags: JSON.parse(r.tags || '[]'),
          createdAt: r.created_at,
          meta: { scope: r.scope, type: r.mem_type },
        }));
      }
      case 2: {
        const rows = this.db.prepare(
          'SELECT id, scenario, key_facts, created_at FROM memory_l2_scenario ORDER BY created_at DESC LIMIT ? OFFSET ?'
        ).all(limit, offset) as any[];
        return rows.map(r => ({
          id: r.id,
          content: r.scenario,
          createdAt: r.created_at,
          meta: { keyFacts: JSON.parse(r.key_facts || '[]') },
        }));
      }
      case 3: {
        const rows = this.db.prepare(
          'SELECT id, trait, evidence, confidence, created_at FROM memory_l3_persona ORDER BY confidence DESC LIMIT ? OFFSET ?'
        ).all(limit, offset) as any[];
        return rows.map(r => ({
          id: r.id,
          content: r.trait,
          createdAt: r.created_at,
          meta: { evidence: JSON.parse(r.evidence || '[]'), confidence: r.confidence },
        }));
      }
      default:
        return [];
    }
  }

  clearAll(): void {
    this.db.exec(`
      DELETE FROM memory_l0_raw;
      DELETE FROM memory_l1_extracted;
      DELETE FROM memory_l2_scenario;
      DELETE FROM memory_l3_persona;
      DELETE FROM memory_embeddings;
    `);
  }

  listUserMemories(limit = 200): Array<{ id: string; content: string; tags: string[]; createdAt: number; source?: string }> {
    const rows = this.db.prepare(
      `SELECT e.id, e.summary, e.tags, e.created_at, r.role
       FROM memory_l1_extracted e
       LEFT JOIN memory_l0_raw r ON e.id = r.id
       WHERE e.mem_type = 'user' OR r.role = 'user' OR e.mem_type IS NULL
       ORDER BY e.created_at DESC LIMIT ?`
    ).all(limit) as any[];
    return rows.map(r => ({
      id: r.id,
      content: r.summary,
      tags: JSON.parse(r.tags || '[]'),
      createdAt: new Date(r.created_at).getTime(),
      source: r.role === 'user' ? 'notebook' : undefined,
    }));
  }

  createUserMemory(input: { content: string; tags: string[]; source?: string }): { id: string; content: string; tags: string[]; createdAt: number; source?: string } {
    const id = `mem_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();
    const segmented = segmentChinese(input.content);
    this.db.prepare(
      `INSERT INTO memory_l0_raw (id, session_id, role, content, segmented_content, scope, mem_type, cwd, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, 'manual', 'user', input.content, segmented, 'global', 'user', null, now);
    this.db.prepare(
      `INSERT INTO memory_l1_extracted (id, source_ids, summary, tags, scope, mem_type, cwd, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, JSON.stringify([id]), input.content, JSON.stringify(input.tags), 'global', 'user', null, now);
    return { id, content: input.content, tags: input.tags, createdAt: Date.now(), source: input.source };
  }

  updateUserMemory(id: string, input: { content?: string; tags?: string[] }): { id: string; content: string; tags: string[] } | null {
    const existing = this.db.prepare('SELECT id FROM memory_l1_extracted WHERE id = ?').get(id) as any;
    if (!existing) return null;
    if (input.content !== undefined) {
      const segmented = segmentChinese(input.content);
      this.db.prepare('UPDATE memory_l0_raw SET content = ?, segmented_content = ? WHERE id = ?').run(input.content, segmented, id);
      this.db.prepare('UPDATE memory_l1_extracted SET summary = ? WHERE id = ?').run(input.content, id);
    }
    if (input.tags !== undefined) {
      this.db.prepare('UPDATE memory_l1_extracted SET tags = ? WHERE id = ?').run(JSON.stringify(input.tags), id);
    }
    const updated = this.db.prepare('SELECT summary, tags FROM memory_l1_extracted WHERE id = ?').get(id) as any;
    return { id, content: updated.summary, tags: JSON.parse(updated.tags || '[]') };
  }

  deleteUserMemory(id: string): boolean {
    const del0 = this.db.prepare('DELETE FROM memory_l0_raw WHERE id = ?').run(id).changes;
    const del1 = this.db.prepare('DELETE FROM memory_l1_extracted WHERE id = ?').run(id).changes;
    return (del0 + del1) > 0;
  }

  close(): void {
    if (this.compactTimer) {
      clearInterval(this.compactTimer);
    }
    this.embeddingClient.close().catch(() => {});
    this.db.close();
  }

  private searchResultToRecord(r: { id: string; layer: number; content: string; metadata: Record<string, unknown> }): MemoryRecord {
    let meta = r.metadata as {
      cwd?: string;
      mem_type?: MemoryType;
      scope?: 'global' | 'project';
      tags?: string[];
    };

    // L0 results don't carry tags/scope — look up L1 for enriched metadata
    if (r.layer === 0) {
      const l1 = this.db.prepare(
        'SELECT tags, scope, mem_type, cwd FROM memory_l1_extracted WHERE id = ?'
      ).get(r.id) as { tags?: string; scope?: string; mem_type?: string; cwd?: string } | undefined;
      if (l1) {
        meta = {
          tags: l1.tags ? JSON.parse(l1.tags) : [],
          scope: (l1.scope as 'global' | 'project') || 'global',
          mem_type: l1.mem_type as MemoryType | undefined,
          cwd: l1.cwd || undefined,
        };
      }
    }

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
}
