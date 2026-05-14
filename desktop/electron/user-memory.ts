import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

export interface UserMemory {
  id: string;
  content: string;
  tags: string[];
  createdAt: number;
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

  private save(): void {
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      writeFileSync(this.filePath, JSON.stringify(this.memories, null, 2));
    } catch { /* silent */ }
  }

  create(input: { content: string; tags: string[]; source?: string }): UserMemory {
    const m: UserMemory = {
      id: `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      content: input.content,
      tags: input.tags,
      createdAt: Date.now(),
      source: input.source,
    };
    this.memories.unshift(m);
    if (this.memories.length > MAX_ENTRIES) {
      this.memories = this.memories.slice(0, MAX_ENTRIES);
    }
    this.save();
    return m;
  }

  list(): UserMemory[] {
    return [...this.memories];
  }

  search(query: string): UserMemory[] {
    if (!query.trim()) return [];
    const lower = query.toLowerCase();
    return this.memories.filter(m =>
      m.content.toLowerCase().includes(lower) ||
      m.tags.some(t => t.toLowerCase().includes(lower))
    );
  }

  delete(id: string): boolean {
    const idx = this.memories.findIndex(m => m.id === id);
    if (idx === -1) return false;
    this.memories.splice(idx, 1);
    this.save();
    return true;
  }
}
