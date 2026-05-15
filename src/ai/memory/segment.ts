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

/**
 * Segment Chinese text for FTS indexing and querying.
 * Returns space-separated tokens for FTS compatibility.
 * Non-Chinese text passes through unchanged.
 */
export function segmentChinese(text: string): string {
  const j = getJieba();
  if (!j) return text;
  try {
    return j.cut(text).join(' ');
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
