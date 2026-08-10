import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';

// Same deterministic selection rule as scripts/step0-office-sample.mts:
// enumerate, hash contents, sort by SHA-256 ascending, take first 40.
const SAMPLE_SIZE = 40;

function eocd(buffer: Buffer): number {
  const min = Math.max(0, buffer.length - 0xffff - 22);
  for (let offset = buffer.length - 22; offset >= min; offset--) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  throw new Error('no eocd');
}

function entries(buffer: Buffer): Array<{ name: string; off: number; size: number; method: number }> {
  const end = eocd(buffer);
  let cursor = buffer.readUInt32LE(end + 16);
  const stop = cursor + buffer.readUInt32LE(end + 12);
  const out: Array<{ name: string; off: number; size: number; method: number }> = [];
  while (cursor < stop) {
    if (buffer.readUInt32LE(cursor) !== 0x02014b50) break;
    const method = buffer.readUInt16LE(cursor + 10);
    const size = buffer.readUInt32LE(cursor + 20);
    const nameLen = buffer.readUInt16LE(cursor + 28);
    const extraLen = buffer.readUInt16LE(cursor + 30);
    const commentLen = buffer.readUInt16LE(cursor + 32);
    const off = buffer.readUInt32LE(cursor + 42);
    out.push({ name: buffer.slice(cursor + 46, cursor + 46 + nameLen).toString('utf8'), off, size, method });
    cursor += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

function readEntry(buffer: Buffer, e: { off: number; size: number; method: number }): string {
  const nameLen = buffer.readUInt16LE(e.off + 26);
  const extraLen = buffer.readUInt16LE(e.off + 28);
  const start = e.off + 30 + nameLen + extraLen;
  const raw = buffer.slice(start, start + e.size);
  return (e.method === 8 ? inflateRawSync(raw) : raw).toString('utf8');
}

function colIndex(ref: string): number {
  let index = 0;
  for (const ch of ref) {
    if (ch < 'A' || ch > 'Z') break;
    index = index * 26 + (ch.charCodeAt(0) - 64);
  }
  return index;
}

const found = execFileSync('/usr/bin/find', [`${process.env.HOME}/Downloads`, '-maxdepth', '2', '-name', '*.xlsx'], {
  encoding: 'utf8',
  maxBuffer: 128 * 1024 * 1024,
})
  .split('\n')
  .filter((line) => line.trim() && !line.includes('~$') && !line.includes('/.'));

const sample = found
  .map((path) => ({ path, sha: createHash('sha256').update(readFileSync(path)).digest('hex') }))
  .sort((a, b) => (a.sha < b.sha ? -1 : a.sha > b.sha ? 1 : 0))
  .slice(0, SAMPLE_SIZE);

let zipReadable = 0;
let filesWithSparse = 0;
let sparseRows = 0;
let totalRows = 0;
let multiLetterCols = 0;

for (const item of sample) {
  const buffer = readFileSync(item.path);
  if (buffer.readUInt32LE(0) !== 0x04034b50) continue;
  let sheets;
  try {
    sheets = entries(buffer).filter((e) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(e.name));
  } catch { continue; }
  if (sheets.length === 0) continue;
  zipReadable += 1;
  let fileSparse = 0;
  for (const sheet of sheets) {
    let xml: string;
    try { xml = readEntry(buffer, sheet); } catch { continue; }
    for (const rowMatch of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      const refs = [...(rowMatch[1] ?? '').matchAll(/<c\b[^>]*\br="([A-Z]+)\d+"/g)].map((m) => m[1]!);
      if (refs.length < 2) continue;
      totalRows += 1;
      if (refs.some((r) => r.length > 1)) multiLetterCols += 1;
      const idx = refs.map(colIndex);
      const contiguous = idx.every((value, i) => value === idx[0]! + i);
      if (!contiguous) { fileSparse += 1; sparseRows += 1; }
    }
  }
  if (fileSparse > 0) filesWithSparse += 1;
}

console.log(`抽样 (SHA-256 升序前 ${SAMPLE_SIZE})     : ${sample.length}`);
console.log(`其中真 ZIP 且含 worksheet         : ${zipReadable}`);
console.log(`含稀疏行（列被静默左移）的文件    : ${filesWithSparse}  (${((filesWithSparse / zipReadable) * 100).toFixed(1)}%)`);
console.log(`受影响行 / 多单元格行             : ${sparseRows} / ${totalRows}  (${((sparseRows / Math.max(1, totalRows)) * 100).toFixed(2)}%)`);
console.log(`含多字母列引用(AA+)的行           : ${multiLetterCols}  → 补位实现必须支持`);
