// ESM-compatible wrapper for nodejieba.
// nodejieba is a CJS package; use createRequire for ESM compat.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

let jieba: { cut(text: string): string[] } | null = null;
let jiebaLoadFailed = false;

function getJieba(): { cut(text: string): string[] } | null {
  if (jiebaLoadFailed) return null;
  if (!jieba) {
    try {
      jieba = require('nodejieba');
    } catch {
      jiebaLoadFailed = true;
      return null;
    }
  }
  return jieba;
}

// Regex to match contiguous Chinese character runs
const CHINESE_RE = /([\u4e00-\u9fff\u3400-\u4dbf]+)/g;

/**
 * Segment Chinese text for FTS indexing and querying.
 * Splits into Chinese / non-Chinese segments. Only Chinese segments go
 * through jieba; English words are preserved intact so FTS can match them.
 */
export function segmentChinese(text: string): string {
  const j = getJieba();
  if (!j) return text;
  try {
    // Split into alternating non-Chinese and Chinese segments
    const parts: string[] = [];
    let lastIndex = 0;
    for (const match of text.matchAll(CHINESE_RE)) {
      // Non-Chinese portion before this match
      if (match.index! > lastIndex) {
        parts.push(text.slice(lastIndex, match.index));
      }
      // Chinese portion — segment with jieba
      parts.push(j.cut(match[0]).join(' '));
      lastIndex = match.index! + match[0].length;
    }
    // Trailing non-Chinese portion
    if (lastIndex < text.length) {
      parts.push(text.slice(lastIndex));
    }
    return parts.join(' ').replace(/\s+/g, ' ').trim();
  } catch {
    return text;
  }
}

/**
 * Segment a query string using the same tokenizer used for indexing.
 * MUST match the segmentation applied during INSERT for BM25 recall.
 */
export function segmentQuery(query: string): string {
  return segmentChinese(query);
}
