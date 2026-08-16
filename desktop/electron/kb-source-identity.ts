import { createHash } from 'node:crypto';

export interface SourceTextChunk {
  text: string;
  charStart: number;
  charEnd: number;
}

export function normalizeKnowledgeSourceText(text: string): string {
  return text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
}

export function computeKnowledgeContentHash(text: string): string {
  return createHash('sha256')
    .update(normalizeKnowledgeSourceText(text), 'utf8')
    .digest('hex');
}

export function reconstructKnowledgeSourceText(chunks: SourceTextChunk[]): string {
  let cursor = 0;
  let text = '';
  for (const chunk of chunks) {
    const overlap = Math.max(0, cursor - chunk.charStart);
    if (overlap < chunk.text.length) text += chunk.text.slice(overlap);
    cursor = Math.max(cursor, chunk.charEnd);
  }
  return text;
}
