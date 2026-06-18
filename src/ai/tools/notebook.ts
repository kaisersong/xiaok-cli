import { randomUUID } from 'node:crypto';
import type { MemoryRecord, MemoryStore } from '../memory/store.js';
import type { Tool } from '../../types.js';

function normalizeContent(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => typeof item === 'string' ? item.trim() : '')
    .filter(Boolean);
}

function buildMemoryRecord(content: string, tags: string[]): MemoryRecord {
  const title = content.replace(/\s+/g, ' ').slice(0, 80) || '未命名笔记';
  return {
    id: randomUUID(),
    scope: 'global',
    title,
    summary: content,
    tags,
    updatedAt: Date.now(),
    type: 'user',
  };
}

function formatNotebookEntries(records: MemoryRecord[]): string {
  if (records.length === 0) {
    return 'Notebook 中还没有匹配的笔记。';
  }

  return records.map((record, index) => {
    const lines = [
      `${index + 1}. ${record.summary || record.title}`,
      `ID: ${record.id}`,
    ];
    if (record.tags.length > 0) {
      lines.push(`Tags: ${record.tags.join(', ')}`);
    }
    return lines.join('\n');
  }).join('\n\n');
}

export function createNotebookTools(store: MemoryStore): Tool[] {
  return [
    {
      permission: 'safe',
      definition: {
        name: 'notebook_write',
        description: '将需要跨对话保留的重要信息写入长期笔记本，例如用户偏好、身份信息和长期约定。',
        inputSchema: {
          type: 'object',
          properties: {
            content: { type: 'string', description: '要写入笔记本的内容' },
            tags: {
              type: 'array',
              description: '可选标签，用于分类或后续检索',
              items: { type: 'string' },
            },
          },
          required: ['content'],
        },
      },
      async execute(input) {
        const content = normalizeContent(input.content);
        if (!content) {
          return 'Error: content 不能为空';
        }

        const tags = normalizeTags(input.tags);
        const record = buildMemoryRecord(content, tags);
        await store.save(record);
        return `已写入 Notebook：${record.title}`;
      },
    },
    {
      permission: 'safe',
      definition: {
        name: 'notebook_read',
        description: '读取长期笔记本中的个人备忘、偏好、身份信息和历史约定。可与 kb_search 同时使用。',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: '检索关键词；留空则返回最近相关笔记' },
            limit: { type: 'number', description: '返回条数，默认 10' },
          },
          required: [],
        },
      },
      async execute(input) {
        const query = normalizeContent(input.query);
        const limit = typeof input.limit === 'number' && Number.isFinite(input.limit)
          ? Math.max(1, Math.min(20, Math.floor(input.limit)))
          : 10;

        const records = store.search
          ? await store.search(query, limit)
          : await store.listRelevant({ cwd: '', query, typeFilter: 'user' });

        return formatNotebookEntries(records.slice(0, limit));
      },
    },
  ];
}
