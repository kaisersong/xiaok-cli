import type { ImportedMemory } from './user-memory.js';

export interface ImportResult {
  items: ImportedMemory[];
  errors: string[];
}

export function parseMemories(raw: string): ImportResult {
  const trimmed = raw.trim();
  if (!trimmed) return { items: [], errors: ['输入内容为空'] };

  const errors: string[] = [];
  let items: ImportedMemory[] = [];

  // 1. Try JSON array first
  items = tryParseJsonArray(trimmed, errors);
  if (items.length > 0 || errors.length === 0) {
    return { items: filterEmpty(items), errors };
  }

  // 2. Try JSON Lines (one object per line)
  items = tryParseJsonLines(trimmed, errors);
  if (items.length > 0) {
    return { items: filterEmpty(items), errors };
  }

  // 3. Try Markdown list (- item or * item or 1. item)
  items = tryParseMarkdownList(trimmed, errors);
  if (items.length > 0) {
    return { items: filterEmpty(items), errors };
  }

  // 4. Plain text: each non-empty line is one memory
  items = tryParsePlainLines(trimmed, errors);
  return { items: filterEmpty(items), errors };
}

// --- Parsers ---

function tryParseJsonArray(raw: string, errors: string[]): ImportedMemory[] {
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.map((item: unknown, i: number) => {
        const normalized = normalizeItem(item, i + 1, errors);
        return normalized;
      });
    }
  } catch {
    errors.push('不是有效的 JSON 数组');
  }
  return [];
}

function tryParseJsonLines(raw: string, _errors: string[]): ImportedMemory[] {
  const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
  const items: ImportedMemory[] = [];
  for (let i = 0; i < lines.length; i++) {
    try {
      const obj = JSON.parse(lines[i]);
      if (typeof obj === 'object' && obj !== null && typeof obj.content === 'string') {
        items.push({
          content: obj.content.trim(),
          tags: Array.isArray(obj.tags) ? obj.tags.filter((t: unknown) => typeof t === 'string') : [],
          source: typeof obj.source === 'string' ? obj.source : undefined,
        });
      }
    } catch { /* skip non-JSON lines */ }
  }
  return items;
}

function tryParseMarkdownList(raw: string, _errors: string[]): ImportedMemory[] {
  const lines = raw.split('\n');
  const items: ImportedMemory[] = [];
  for (const line of lines) {
    const match = line.match(/^\s*[-*]\s+(.+)$/);
    if (match) {
      const content = match[1].trim();
      if (content) items.push({ content, tags: [], source: undefined });
    }
  }
  return items;
}

function tryParsePlainLines(raw: string, _errors: string[]): ImportedMemory[] {
  return raw
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0)
    .filter(l => !l.startsWith('{') && !l.startsWith('[')) // skip JSON fragments
    .map(content => ({ content, tags: [], source: undefined }));
}

// --- Normalization ---

function normalizeItem(raw: unknown, index: number, errors: string[]): ImportedMemory {
  if (typeof raw === 'string') {
    return { content: raw.trim(), tags: [], source: undefined };
  }
  if (typeof raw !== 'object' || raw === null) {
    errors.push(`第 ${index} 项格式无效: ${typeof raw}`);
    return { content: '', tags: [], source: undefined };
  }
  const obj = raw as Record<string, unknown>;
  const content = typeof obj.content === 'string' ? obj.content.trim() : '';
  if (!content) {
    errors.push(`第 ${index} 项缺少 content 字段`);
  }
  const tags: string[] = [];
  const rawTags = obj.tags;
  if (Array.isArray(rawTags)) {
    for (const t of rawTags) {
      if (typeof t === 'string' && t.trim()) tags.push(t.trim());
    }
  }
  return {
    content,
    tags,
    source: typeof obj.source === 'string' ? obj.source : undefined,
  };
}

function filterEmpty(items: ImportedMemory[]): ImportedMemory[] {
  return items.filter(i => i.content.length > 0);
}
