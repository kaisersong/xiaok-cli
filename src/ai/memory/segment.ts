// ESM-compatible wrapper for nodejieba.
// nodejieba is a CJS package; use createRequire for ESM compat.
import { accessSync, constants as fsConstants } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);

interface JiebaModule {
  cut(text: string): string[];
  load(dict: {
    dict: string;
    hmmDict: string;
    userDict: string;
    idfDict: string;
    stopWordDict: string;
  }): unknown;
}

let jieba: JiebaModule | null = null;
let jiebaLoadFailed = false;

// The five dictionaries cppjieba opens natively.
const DICT_FILES = {
  dict: 'jieba.dict.utf8',
  hmmDict: 'hmm_model.utf8',
  userDict: 'user.dict.utf8',
  idfDict: 'idf.utf8',
  stopWordDict: 'stop_words.utf8',
} as const;

/**
 * Point a path at app.asar.unpacked instead of app.asar.
 *
 * Electron patches `fs` so JS reads inside app.asar work, but cppjieba opens
 * its dictionaries with C++ ifstream, which bypasses that patch. electron-builder
 * unpacks native modules to app.asar.unpacked while `__dirname` still reports the
 * app.asar path, so the path has to be rewritten explicitly.
 */
export function rewriteAsarPath(filePath: string): string {
  if (filePath.includes('app.asar.unpacked')) return filePath;
  // Only rewrite when `app.asar` is a full path segment, so a directory that
  // merely starts with that name is left alone. Handles both separators.
  return filePath.replace(/app\.asar([/\\])/, 'app.asar.unpacked$1');
}

/**
 * Resolve every dictionary to a path that is readable from JS, or null when
 * nodejieba is not installed.
 */
export function resolveJiebaDictPaths(): Record<string, string> | null {
  let entry: string;
  try {
    entry = require.resolve('nodejieba');
  } catch {
    return null;
  }
  const dictDir = rewriteAsarPath(join(dirname(entry), 'submodules', 'cppjieba', 'dict'));
  const resolved: Record<string, string> = {};
  for (const fileName of Object.values(DICT_FILES)) {
    resolved[fileName] = join(dictDir, fileName);
  }
  return resolved;
}

/**
 * Whether Chinese segmentation can actually run.
 *
 * Requiring nodejieba is not enough: dictionary loading is lazy, so a require
 * succeeds even when the dictionaries are unreachable, and the first cut() would
 * then abort the process from C++. This probes readability from JS first.
 */
export function segmentationAvailable(): boolean {
  return getJieba() !== null;
}

function getJieba(): JiebaModule | null {
  if (jiebaLoadFailed) return null;
  if (!jieba) {
    try {
      const paths = resolveJiebaDictPaths();
      if (paths === null) {
        jiebaLoadFailed = true;
        return null;
      }
      // Verify every dictionary is readable before handing paths to native code,
      // because a failed native open calls abort() and cannot be caught here.
      for (const fileName of Object.values(DICT_FILES)) {
        accessSync(paths[fileName], fsConstants.R_OK);
      }
      const mod = require('nodejieba') as JiebaModule;
      mod.load({
        dict: paths[DICT_FILES.dict],
        hmmDict: paths[DICT_FILES.hmmDict],
        userDict: paths[DICT_FILES.userDict],
        idfDict: paths[DICT_FILES.idfDict],
        stopWordDict: paths[DICT_FILES.stopWordDict],
      });
      jieba = mod;
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
