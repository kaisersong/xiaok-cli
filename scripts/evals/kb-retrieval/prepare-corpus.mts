/**
 * 从用户真实 KB 库导出干净语料，供检索评测使用。
 *
 * 只读用户库，绝不写。输出到 ~/.xiaok/eval-fixtures/kb-retrieval/ —— 本机目录，
 * 不进 repo，因为语料是用户的真实业务文档。
 *
 * 有 raw_path 的用修好的 extractor 重新提取；无 raw_path 的（paste 类）
 * 退回到对库内已有 chunk 文本做 stripMarkup 近似还原。
 */
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSourceExtractor, stripMarkup } from '../../../desktop/electron/kb-source-extractor.js';

const OUT_DIR = join(homedir(), '.xiaok', 'eval-fixtures', 'kb-retrieval');

function resolveUserDb(): string {
  const candidates = [
    join(homedir(), 'Library', 'Application Support', 'xiaok-desktop', 'knowledge.db'),
    join(homedir(), 'Library', 'Application Support', 'Electron', 'knowledge.db'),
  ];
  const found = candidates.find(p => existsSync(p));
  if (!found) throw new Error('找不到用户 knowledge.db');
  return found;
}

const MARKUP_TITLE = /\.(html?|xml|svg)$/i;

async function main(): Promise<void> {
  const userDb = resolveUserDb();
  // 复制到临时位置再读，避免对用户库产生任何锁或 WAL 写入
  const scratch = join(tmpdir(), `kb-eval-src-${process.pid}.db`);
  copyFileSync(userDb, scratch);

  try {
    const db = new DatabaseSync(scratch);
    mkdirSync(OUT_DIR, { recursive: true });

    const extractor = createSourceExtractor();
    const sources = db.prepare('SELECT id, title, kind, raw_path, mime_type FROM sources ORDER BY title').all() as Array<{
      id: string; title: string; kind: string; raw_path: string; mime_type: string;
    }>;

    const manifest: Array<{ sourceId: string; title: string; kind: string; origin: string; chars: number; file: string }> = [];

    for (const source of sources) {
      let text = '';
      let origin = '';

      if (source.raw_path && existsSync(source.raw_path)) {
        const result = await extractor.extract({
          filePath: source.raw_path,
          mimeType: source.mime_type || 'application/octet-stream',
        });
        if (result.ok && result.text) {
          text = result.text;
          origin = 're-extracted';
        }
      }

      if (!text) {
        const chunks = db.prepare('SELECT text FROM chunks WHERE source_id = ? ORDER BY idx').all(source.id) as Array<{ text: string }>;
        const joined = chunks.map(c => c.text).join('');
        if (!joined) continue;
        text = MARKUP_TITLE.test(source.title)
          ? stripMarkup(joined, { dropInlineGraphics: true })
          : joined;
        origin = MARKUP_TITLE.test(source.title) ? 'stripped-from-chunks' : 'chunks-verbatim';
      }

      const file = `${source.id}.txt`;
      writeFileSync(join(OUT_DIR, file), text, 'utf8');
      manifest.push({ sourceId: source.id, title: source.title, kind: source.kind, origin, chars: text.length, file });
    }

    writeFileSync(join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

    console.log(`语料输出目录：${OUT_DIR}`);
    console.log(`source 数：${manifest.length}，总字符：${manifest.reduce((s, m) => s + m.chars, 0)}`);
    for (const m of manifest) {
      console.log(`  ${m.origin.padEnd(20)} ${String(m.chars).padStart(7)} 字符  ${m.title.slice(0, 46)}`);
    }
  } finally {
    rmSync(scratch, { force: true });
    rmSync(`${scratch}-wal`, { force: true });
    rmSync(`${scratch}-shm`, { force: true });
  }
}

await main();
