import { describe, expect, it, vi } from 'vitest';
import { createNotebookTools } from '../../../src/ai/tools/notebook.js';
import type { MemoryStore } from '../../../src/ai/memory/store.js';

function buildStore(overrides: Partial<MemoryStore> = {}): MemoryStore {
  return {
    async save() {},
    async listRelevant() { return []; },
    ...overrides,
  };
}

describe('createNotebookTools', () => {
  it('writes notebook entries into the memory store', async () => {
    const save = vi.fn<MemoryStore['save']>().mockResolvedValue(undefined);
    const tools = createNotebookTools(buildStore({ save }));
    const writeTool = tools.find((tool) => tool.definition.name === 'notebook_write');

    expect(writeTool).toBeDefined();
    const result = await writeTool!.execute({
      content: '用户偏好：代码使用 TypeScript',
      tags: ['偏好'],
    });

    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(expect.objectContaining({
      scope: 'global',
      title: '用户偏好：代码使用 TypeScript',
      summary: '用户偏好：代码使用 TypeScript',
      tags: ['偏好'],
      type: 'user',
    }));
    expect(result).toContain('已写入');
  });

  it('reads notebook entries from store search results', async () => {
    const search = vi.fn<NonNullable<MemoryStore['search']>>().mockResolvedValue([
      {
        id: 'm1',
        scope: 'global',
        title: '用户名字：张三',
        summary: '用户名字：张三',
        tags: ['个人信息'],
        updatedAt: 1,
        type: 'user',
      },
      {
        id: 'm2',
        scope: 'global',
        title: '用户偏好：TypeScript',
        summary: '用户偏好：TypeScript',
        tags: ['偏好'],
        updatedAt: 2,
        type: 'user',
      },
    ]);
    const tools = createNotebookTools(buildStore({ search }));
    const readTool = tools.find((tool) => tool.definition.name === 'notebook_read');

    expect(readTool).toBeDefined();
    const result = await readTool!.execute({ query: '用户', limit: 2 });

    expect(search).toHaveBeenCalledWith('用户', 2);
    expect(result).toContain('1. 用户名字：张三');
    expect(result).toContain('Tags: 个人信息');
    expect(result).toContain('2. 用户偏好：TypeScript');
  });
});
