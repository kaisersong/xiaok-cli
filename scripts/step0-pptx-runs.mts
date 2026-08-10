import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';

function eocd(buffer: Buffer): number {
  const min = Math.max(0, buffer.length - 0xffff - 22);
  for (let offset = buffer.length - 22; offset >= min; offset--) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  throw new Error('no eocd');
}

function entries(buffer: Buffer) {
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

const found = execFileSync('/usr/bin/find', [`${process.env.HOME}/Downloads`, '-maxdepth', '2', '-name', '*.pptx'], {
  encoding: 'utf8',
  maxBuffer: 128 * 1024 * 1024,
})
  .split('\n')
  .filter((l) => l.trim() && !l.includes('~$') && !l.includes('/.'));

const sample = found
  .map((path) => ({ path, sha: createHash('sha256').update(readFileSync(path)).digest('hex') }))
  .sort((a, b) => (a.sha < b.sha ? -1 : a.sha > b.sha ? 1 : 0))
  .slice(0, 40);

let paragraphs = 0;
let multiRunParagraphs = 0;
let totalRuns = 0;
let filesWithMultiRun = 0;

for (const item of sample) {
  const buffer = readFileSync(item.path);
  let slides;
  try {
    slides = entries(buffer).filter((e) => /^ppt\/slides\/slide\d+\.xml$/i.test(e.name));
  } catch { continue; }
  let fileMulti = 0;
  for (const slide of slides) {
    let xml: string;
    try { xml = readEntry(buffer, slide); } catch { continue; }
    for (const p of xml.matchAll(/<a:p\b[^>]*>([\s\S]*?)<\/a:p>/g)) {
      const runs = [...(p[1] ?? '').matchAll(/<a:t\b[^>]*>([\s\S]*?)<\/a:t>/g)];
      if (runs.length === 0) continue;
      paragraphs += 1;
      totalRuns += runs.length;
      if (runs.length > 1) { multiRunParagraphs += 1; fileMulti += 1; }
    }
  }
  if (fileMulti > 0) filesWithMultiRun += 1;
}

console.log(`真实 pptx 样本                 : ${sample.length}`);
console.log(`含多 run 段落的文件            : ${filesWithMultiRun}  (${((filesWithMultiRun / sample.length) * 100).toFixed(1)}%)`);
console.log(`有文本的段落总数               : ${paragraphs}`);
console.log(`其中含 >1 个 run 的段落        : ${multiRunParagraphs}  (${((multiRunParagraphs / paragraphs) * 100).toFixed(1)}%)`);
console.log(`run 总数 / 段落数              : ${totalRuns} / ${paragraphs}  → 修复前多出 ${totalRuns - paragraphs} 行碎片 (${(((totalRuns - paragraphs) / totalRuns) * 100).toFixed(1)}% 的行是被错误拆出来的)`);
