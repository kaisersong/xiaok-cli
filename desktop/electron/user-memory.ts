import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

export interface UserMemory {
  id: string;
  content: string;
  tags: string[];
  createdAt: number;
  source?: string;
  scope?: 'global' | 'project';
  cwd?: string;
  type?: 'user' | 'feedback' | 'project' | 'reference';
  provenance?: { kind: 'assistant_candidate'; candidateId: string; runId: string } | Record<string, unknown>;
}

export interface ImportedMemory {
  content: string;
  tags?: string[];
  source?: string;
}

const FILE_NAME = 'user-memories.json';
const MAX_ENTRIES = 500;

export class UserMemoryStore {
  private filePath: string;
  private memories: UserMemory[] = [];

  constructor(dataDir: string) {
    this.filePath = join(dataDir, FILE_NAME);
    this.load();
  }

  private load(): void {
    try {
      if (!existsSync(this.filePath)) return;
      const raw = readFileSync(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      this.memories = parsed;
    } catch {
      this.memories = [];
    }
  }

  private persist(): void {
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      writeFileSync(this.filePath, JSON.stringify(this.memories, null, 2));
    } catch (e) { console.warn('[memory] save to disk failed:', (e as Error).message) }
  }

  create(input: { content: string; tags: string[]; source?: string; scope?: UserMemory['scope']; cwd?: string; type?: UserMemory['type']; provenance?: UserMemory['provenance'] }): UserMemory {
    const m: UserMemory = {
      id: `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      content: input.content,
      tags: input.tags,
      createdAt: Date.now(),
      source: input.source,
      scope: input.scope ?? 'global',
      cwd: input.cwd,
      type: input.type ?? 'user',
      provenance: input.provenance,
    };
    this.memories.unshift(m);
    this.enforceCapacity();
    this.persist();
    return m;
  }

  list(): UserMemory[] {
    return [...this.memories];
  }

  getById(id: string): UserMemory | undefined {
    const memory = this.memories.find(item => item.id === id);
    return memory ? { ...memory, tags: [...memory.tags] } : undefined;
  }

  save(record: UserMemory): UserMemory {
    const existingIndex = this.memories.findIndex(item => item.id === record.id);
    const normalized: UserMemory = {
      ...record,
      tags: [...record.tags],
      scope: record.scope ?? 'global',
      type: record.type ?? 'user',
    };
    if (existingIndex >= 0) this.memories.splice(existingIndex, 1);
    this.memories.unshift(normalized);
    this.enforceCapacity();
    this.persist();
    return { ...normalized, tags: [...normalized.tags] };
  }

  listRelevant(input: { cwd: string; query: string }): UserMemory[] {
    const query = input.query.trim().toLowerCase();
    return this.memories.filter(memory => {
      if (memory.scope === 'project' && memory.cwd !== input.cwd) return false;
      if (!query) return true;
      return memory.content.toLowerCase().includes(query) || memory.tags.some(tag => tag.toLowerCase().includes(query));
    }).map(memory => ({ ...memory, tags: [...memory.tags] }));
  }

  search(query: string): UserMemory[] {
    if (!query.trim()) return [];
    const lower = query.toLowerCase();
    return this.memories.filter(m =>
      m.content.toLowerCase().includes(lower) ||
      m.tags.some(t => t.toLowerCase().includes(lower))
    );
  }

  update(id: string, input: { content?: string; tags?: string[] }): UserMemory | null {
    const m = this.memories.find(m => m.id === id);
    if (!m) return null;
    if (input.content !== undefined) m.content = input.content;
    if (input.tags !== undefined) m.tags = input.tags;
    this.persist();
    return { ...m };
  }

  delete(id: string): boolean {
    const idx = this.memories.findIndex(m => m.id === id);
    if (idx === -1) return false;
    this.memories.splice(idx, 1);
    this.persist();
    return true;
  }

  importMemories(items: ImportedMemory[]): { imported: number; deduped: number } {
    const existing = new Set(this.memories.map(m => m.content.toLowerCase().trim()));
    let imported = 0;
    let deduped = 0;
    for (const item of items) {
      const content = (item.content || '').trim();
      if (!content) continue;
      if (existing.has(content.toLowerCase())) {
        deduped++;
        continue;
      }
      const tags = deduceTags(content, item.tags || []);
      this.create({ content, tags, source: item.source || 'import' });
      existing.add(content.toLowerCase());
      imported++;
    }
    return { imported, deduped };
  }

  private enforceCapacity(): void {
    while (this.memories.length > MAX_ENTRIES) {
      const removable = this.memories.map((memory, index) => ({ memory, index })).reverse()
        .find(({ memory }) => memory.provenance?.kind !== 'assistant_candidate');
      if (!removable) throw new Error('User memory capacity is full of protected assistant records.');
      this.memories.splice(removable.index, 1);
    }
  }
}

function deduceTags(content: string, providedTags: string[]): string[] {
  const tags = [...providedTags];
  const lower = content.toLowerCase();

  if (tags.length === 0) {
    if (/偏好|喜欢|默认|prefer|like|default/i.test(content)) tags.push('preference');
    if (/项目|project|仓库|repo/i.test(content)) tags.push('project');
    if (/测试|test|ci|lint/i.test(content)) tags.push('workflow');
    if (/bug|修复|fix|错误|error/i.test(content)) tags.push('bug');
    if (/部署|deploy|发布|release|上线/i.test(content)) tags.push('deploy');
    if (/架构|architecture|技术栈|stack|框架|framework/i.test(content)) tags.push('architecture');
    if (/团队|team|成员|member|协作/i.test(content)) tags.push('team');
  }

  return [...new Set(tags)];
}
