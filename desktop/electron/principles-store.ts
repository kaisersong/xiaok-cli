import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { captureIpcData } from './ipc-data-snapshot.js';
import { PRINCIPLE_SAVE_INPUT_SCHEMA, PRINCIPLE_LIST_RESULT_SCHEMA, type PrincipleSaveInput, type ProjectPrincipleDto } from '../shared/principles-ipc-contract.js';

export type PrincipleScenario = 'planning' | 'execution' | 'review' | 'delivery';

export type ProjectPrinciple = ProjectPrincipleDto;

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

  save(principle: PrincipleSaveInput, requestSource?: 'user' | 'agent' | 'scheduler'): Promise<{ success: boolean; error?: string }> {
    if (requestSource !== 'user') throw Error('principles_user_required');
    const snapshot = captureIpcData(principle, 'principles_input_invalid');
    if (!PRINCIPLE_SAVE_INPUT_SCHEMA.safeParse(snapshot).success) throw Error('principles_input_invalid');
    return this.enqueue(() => this.doSave(snapshot));
  }

  delete(id: string, requestSource?: 'user' | 'agent' | 'scheduler'): Promise<{ success: boolean }> {
    if (requestSource !== 'user') throw Error('principles_user_required');
    if (typeof id !== 'string') throw Error('principles_input_invalid');
    return this.enqueue(() => this.doDelete(id));
  }

  private doSave(principle: PrincipleSaveInput): { success: boolean; error?: string } {
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
    if (principle.scenarios.some(s => !VALID_SCENARIOS.includes(s as PrincipleScenario))) {
      return { success: false, error: '包含无效的场景值' };
    }

    const list = this.readQualifiedForMutation();
    const existingIdx = list.findIndex(p => p.id === principle.id);

    // Capacity check (only for new items)
    if (existingIdx === -1 && list.length >= MAX_COUNT) {
      return { success: false, error: `原则数量已达上限 (${MAX_COUNT})` };
    }

    if (existingIdx >= 0) {
      list[existingIdx] = principle as ProjectPrinciple;
    } else {
      list.push(principle as ProjectPrinciple);
    }

    this.persist(list);
    return { success: true };
  }

  private doDelete(id: string): { success: boolean } {
    const list = this.readQualifiedForMutation();
    const filtered = list.filter(p => p.id !== id);
    this.persist(filtered);
    return { success: true };
  }

  private readQualifiedForMutation(): ProjectPrinciple[] {
    // Read inside the queued operation; never rewrite a parsed but unqualified historical file.
    const snapshot = captureIpcData(this.list(), 'principles_projection_unavailable');
    if (!PRINCIPLE_LIST_RESULT_SCHEMA.safeParse(snapshot).success) throw Error('principles_projection_unavailable');
    return snapshot;
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
