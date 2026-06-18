/**
 * Knowledge Base — Chunker
 *
 * Splits extracted text into overlapping chunks with structural metadata.
 * Respects page/slide/sheet breaks for document positioning.
 */

import type { Chunker, ChunkerInput, ChunkOutput } from './kb-store.js';

const CN_CHUNK_SIZE = 500;
const EN_CHUNK_SIZE = 800;
const OVERLAP_RATIO = 0.1;

function isMostlyChinese(text: string): boolean {
  const cjk = text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g);
  return (cjk?.length ?? 0) > text.length * 0.15;
}

function findSentenceBoundary(text: string, target: number): number {
  const sentenceEnds = /[。！？.!?\n]/g;
  let best = target;
  let match: RegExpExecArray | null;
  sentenceEnds.lastIndex = 0;
  while ((match = sentenceEnds.exec(text)) !== null) {
    if (match.index <= target) {
      best = match.index + 1;
    } else {
      break;
    }
  }
  return best;
}

export function createChunker(): Chunker {
  return {
    chunk(input: ChunkerInput): ChunkOutput[] {
      const { text, pageBreaks, slideBreaks, sheetBreaks } = input;
      if (!text || text.length === 0) return [];

      const chunkSize = isMostlyChinese(text) ? CN_CHUNK_SIZE : EN_CHUNK_SIZE;
      const overlap = Math.round(chunkSize * OVERLAP_RATIO);
      const results: ChunkOutput[] = [];
      let pos = 0;
      let idx = 0;

      while (pos < text.length) {
        let end = Math.min(pos + chunkSize, text.length);
        if (end < text.length) {
          end = findSentenceBoundary(text.slice(pos, end + overlap), chunkSize);
          end = pos + end;
          if (end <= pos) end = pos + chunkSize;
          if (end > text.length) end = text.length;
        }

        const chunkText = text.slice(pos, end);
        const pageIndex = resolvePageIndex(pos, pageBreaks);
        const slideIndex = resolveSlideIndex(pos, slideBreaks);
        const sheetInfo = resolveSheetInfo(pos, sheetBreaks);

        results.push({
          idx,
          text: chunkText,
          charStart: pos,
          charEnd: end,
          pageIndex: pageIndex ?? undefined,
          slideIndex: slideIndex ?? undefined,
          sheetName: sheetInfo?.name,
        });

        pos = end - overlap;
        if (pos <= results[results.length - 1].charStart) pos = end;
        idx++;
      }

      return results;
    },
  };
}

function resolvePageIndex(pos: number, breaks?: number[]): number | null {
  if (!breaks || breaks.length === 0) return null;
  let page = 0;
  for (const bp of breaks) {
    if (pos >= bp) page++;
    else break;
  }
  return page;
}

function resolveSlideIndex(pos: number, breaks?: number[]): number | null {
  if (!breaks || breaks.length === 0) return null;
  let slide = 0;
  for (const bp of breaks) {
    if (pos >= bp) slide++;
    else break;
  }
  return slide;
}

function resolveSheetInfo(pos: number, breaks?: Array<{ name: string; charStart: number }>): { name: string } | null {
  if (!breaks || breaks.length === 0) return null;
  let current: { name: string } | null = null;
  for (const sb of breaks) {
    if (pos >= sb.charStart) current = { name: sb.name };
    else break;
  }
  return current;
}
