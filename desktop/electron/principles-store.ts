import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';

export type PrincipleScenario = 'planning' | 'execution' | 'review' | 'delivery';

export interface ProjectPrinciple {
  id: string;
  content: string;
  scenarios: PrincipleScenario[];
  source: 'manual' | 'memory';
  kind?: 'knowledge' | 'rule';
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

const VALID_SCENARIOS: PrincipleScenario[] = ['planning', 'execution', 'review', 'delivery'];
const MAX_COUNT = 50;
const MAX_CONTENT_LENGTH = 4000;

export class PrinciplesStore {
  private filePath: string;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(dataDir: string) {
    this.filePath = join(dataDir, 'project-principles.json');
    mkdirSync(dataDir, { recursive: true });
  }

  list(): ProjectPrinciple[] {
    if (!existsSync(this.filePath)) return [];
    try {
      const raw = readFileSync(this.filePath, 'utf-8');
      return JSON.parse(raw) as ProjectPrinciple[];
    } catch {
      return [];
    }
  }

  save(principle: ProjectPrinciple): Promise<{ success: boolean; error?: string }> {
    return this.enqueue(() => this.doSave(principle));
  }

  delete(id: string): Promise<{ success: boolean }> {
    return this.enqueue(() => this.doDelete(id));
  }

  private doSave(principle: ProjectPrinciple): { success: boolean; error?: string } {
    // Validate content
    if (!principle.content || principle.content.trim().length === 0) {
      return { success: false, error: '原则内容不能为空' };
    }
    if (principle.content.length > MAX_CONTENT_LENGTH) {
      return { success: false, error: `原则内容不能超过 ${MAX_CONTENT_LENGTH} 字` };
    }
    // Validate scenarios
    if (!Array.isArray(principle.scenarios) || principle.scenarios.length === 0) {
      return { success: false, error: '至少选择一个适用场景' };
    }
    if (principle.scenarios.some(s => !VALID_SCENARIOS.includes(s))) {
      return { success: false, error: '包含无效的场景值' };
    }

    const list = this.list();
    const existingIdx = list.findIndex(p => p.id === principle.id);

    // Capacity check (only for new items)
    if (existingIdx === -1 && list.length >= MAX_COUNT) {
      return { success: false, error: `原则数量已达上限 (${MAX_COUNT})` };
    }

    if (existingIdx >= 0) {
      list[existingIdx] = principle;
    } else {
      list.push(principle);
    }

    this.persist(list);
    return { success: true };
  }

  private doDelete(id: string): { success: boolean } {
    const list = this.list();
    const filtered = list.filter(p => p.id !== id);
    this.persist(filtered);
    return { success: true };
  }

  private persist(data: ProjectPrinciple[]): void {
    const tmpPath = this.filePath + '.tmp';
    writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
    renameSync(tmpPath, this.filePath);
  }

  private enqueue<T>(fn: () => T): Promise<T> {
    const task = this.writeQueue.then(() => fn());
    this.writeQueue = task.then(() => {}, () => {});
    return task;
  }
}
