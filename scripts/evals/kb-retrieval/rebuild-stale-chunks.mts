/**
 * 重建存量含噪声的 chunk。
 *
 * 只处理**有 raw_path 且文件仍存在**的 source：删除旧 chunk → 用修好的
 * extractor 重新提取 → 用生产 chunker 重新切分 → 插入。
 *
 * 无 raw_path 的 source（paste 类）一律跳过并保留原样。从已切分的 chunk 反向
 * 还原不可靠：chunk 边界会把标签切断，stripMarkup 认不出半个标签，实测残留
 * `button class="export-item"` 这类碎片。对这类 source，删除就是丢内容。
 *
 * 用法：
 *   npx tsx scripts/evals/kb-retrieval/rebuild-stale-chunks.mts --dry-run
 *   npx tsx scripts/evals/kb-retrieval/rebuild-stale-chunks.mts --apply
 */
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createSourceExtractor, stripMarkup } from '../../../desktop/electron/kb-source-extractor.js';
import { createChunker } from '../../../desktop/electron/kb-chunker.js';

const APPLY = process.argv.includes('--apply');
const TAG_RE = /<[a-zA-Z/!][^>]*>/g;

function resolveDbPath(): string {
  const candidate = join(homedir(), 'Library', 'Application Support', 'xiaok-desktop', 'knowledge.db');
  if (!existsSync(candidate)) throw new Error(`找不到 knowledge.db：${candidate}`);
  return candidate;
}

interface SourceRow {
  id: string; title: string; kind: string; raw_path: string; mime_type: string; collection_id: string;
}

function countNoise(text: string): number {
  return (text.match(TAG_RE) ?? []).length;
}

async function main(): Promise<void> {
  const dbPath = resolveDbPath();
  const db = new DatabaseSync(dbPath);
  const extractor = createSourceExtractor();
  const chunker = createChunker();

  console.log(`库：${dbPath}`);
  console.log(APPLY ? '模式：APPLY（会写库）\n' : '模式：DRY-RUN（不写库）\n');

  const sources = db.prepare(
    'SELECT id, title, kind, raw_path, mime_type, collection_id FROM sources ORDER BY title',
  ).all() as unknown as SourceRow[];

  let rebuilt = 0;
  let skipped = 0;
  let noiseBefore = 0;
  let noiseAfter = 0;

  for (const source of sources) {
    const existing = db.prepare('SELECT id, text FROM chunks WHERE source_id = ? ORDER BY idx')
      .all(source.id) as unknown as Array<{ id: string; text: string }>;
    const before = existing.reduce((sum, c) => sum + countNoise(c.text), 0);
    noiseBefore += before;

    if (before === 0) {
      skipped += 1;
      continue;
    }

    let freshText = '';
    let origin = '';

    if (source.raw_path && existsSync(source.raw_path)) {
      const extracted = await extractor.extract({
        filePath: source.raw_path,
        mimeType: source.mime_type || 'application/octet-stream',
      });
      if (extracted.ok && extracted.text) {
        freshText = extracted.text;
        origin = '原文重提取';
      }
    }

    if (!freshText) {
      // 回退：从已切分的 chunk 拼接后清洗。不如原文可靠 —— chunk 边界会切断
      // 标签，半个标签认不出来，所以会留碎片。但它不丢 source，也不需要原始文件。
      const joined = existing.map(c => c.text).join('');
      const cleaned = stripMarkup(joined, { dropInlineGraphics: true });
      if (cleaned && countNoise(cleaned) < before) {
        freshText = cleaned;
        origin = 'chunk 拼接清洗';
      }
    }

    if (!freshText) {
      noiseAfter += before;
      skipped += 1;
      console.log(`  跳过（无法在不丢内容的前提下降噪）  噪声标签 ${before}  ${source.title.slice(0, 44)}`);
      continue;
    }

    const fresh = chunker.chunk({ text: freshText, mimeType: source.mime_type || 'text/plain' });
    const after = fresh.reduce((sum, c) => sum + countNoise(c.text), 0);
    noiseAfter += after;

    console.log(
      `  重建（${origin}）  chunk ${existing.length} → ${fresh.length}`
      + `  噪声标签 ${before} → ${after}`
      + `  ${source.title.slice(0, 44)}`,
    );

    if (APPLY) {
      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare('DELETE FROM chunks WHERE source_id = ?').run(source.id);
        const insert = db.prepare(`
          INSERT INTO chunks (id, source_id, collection_id, idx, text, char_start, char_end,
                              page_index, slide_index, sheet_name, embedding_status, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
        `);
        const now = Date.now();
        for (const chunk of fresh) {
          insert.run(
            `${source.id}-${chunk.idx}`, source.id, source.collection_id, chunk.idx, chunk.text,
            chunk.charStart, chunk.charEnd,
            chunk.pageIndex ?? null, chunk.slideIndex ?? null, chunk.sheetName ?? null, now,
          );
        }
        db.prepare('UPDATE sources SET updated_at = ? WHERE id = ?').run(now, source.id);
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    }
    rebuilt += 1;
  }

  console.log(`\n重建 ${rebuilt} 个 source，跳过 ${skipped} 个`);
  console.log(`噪声标签总数：${noiseBefore} → ${noiseAfter}`);
  if (!APPLY) console.log('\n这是 dry-run。确认无误后加 --apply 实际写入。');
  db.close();
}

await main();
