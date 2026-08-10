import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { openSync, readSync, closeSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname } from 'node:path';
import { extractMaterialText } from '/Users/song/projects/xiaok-cli/src/runtime/materials/text-extractor.js';
import { extractPdfText } from '/Users/song/projects/xiaok-cli/desktop/electron/pdf-text.js';

const MIME: Record<string, string> = {
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pdf': 'application/pdf',
};

const SAMPLE_SIZE = 40;

function magicKind(file: string): string {
  const fd = openSync(file, 'r');
  const buf = Buffer.alloc(8);
  readSync(fd, buf, 0, 8, 0);
  closeSync(fd);
  const hex = buf.toString('hex');
  if (hex.startsWith('504b0304')) return 'zip';
  if (hex.startsWith('d0cf11e0a1b11ae1')) return 'ole2';
  if (buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  if (hex.startsWith('3c3f786d6c')) return 'xml';
  return `other:${hex.slice(0, 8)}`;
}

// Deterministic selection: enumerate, then sort by content SHA-256 ascending, take first N.
// Sorting by hash (not path or mtime) makes the sample independent of filesystem order,
// locale collation, and the user's private file names.
function selectSample(ext: string): Array<{ path: string; sha: string }> {
  const found = execFileSync('/usr/bin/find', [`${process.env.HOME}/Downloads`, '-maxdepth', '2', '-name', `*${ext}`], {
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
  })
    .split('\n')
    .filter((line) => line.trim() && !line.includes('~$') && !line.includes('/.'));
  const hashed = found.map((path) => ({
    path,
    sha: createHash('sha256').update(readFileSync(path)).digest('hex'),
  }));
  hashed.sort((a, b) => (a.sha < b.sha ? -1 : a.sha > b.sha ? 1 : 0));
  return hashed.slice(0, SAMPLE_SIZE);
}

const rows: string[] = [];
const summary: string[] = [];

for (const ext of ['.docx', '.pptx', '.xlsx', '.pdf']) {
  const sample = selectSample(ext);
  let parsed = 0;
  let empty = 0;
  const reasons = new Map<string, number>();
  const magicCounts = new Map<string, number>();

  for (const item of sample) {
    const size = statSync(item.path).size;
    const kind = magicKind(item.path);
    magicCounts.set(kind, (magicCounts.get(kind) ?? 0) + 1);
    const result = await extractMaterialText({
      workspacePath: item.path,
      mimeType: MIME[extname(item.path).toLowerCase()]!,
      // PDF 是宿主能力，提取器本身不含 pdfjs —— 与 Desktop 生产路径一致地注入。
      ...(ext === '.pdf' ? { pdfToText: extractPdfText } : {}),
    });
    const text = result.text ?? '';
    const lines = text.split('\n').filter((line) => line.trim());
    const medianLine = lines.length
      ? lines.map((l) => l.length).sort((a, b) => a - b)[Math.floor(lines.length / 2)]
      : 0;
    const status = result.parseStatus === 'parsed' && text.trim() ? 'parsed' : result.parseStatus;
    if (status === 'parsed') parsed += 1;
    else if (result.parseStatus === 'parsed') empty += 1;
    else reasons.set(result.errorMessage ?? status, (reasons.get(result.errorMessage ?? status) ?? 0) + 1);

    rows.push(
      `| ${item.sha.slice(0, 12)} | ${ext.slice(1)} | ${size} | ${kind} | ${status} | ${text.length} | ${lines.length} | ${medianLine} |`,
    );
  }

  summary.push(`### ${ext}  (n=${sample.length})`);
  summary.push('');
  summary.push(`- parsed with text: **${parsed} / ${sample.length}** (${((parsed / sample.length) * 100).toFixed(1)}%)`);
  if (empty) summary.push(`- parsed but empty: ${empty}`);
  summary.push(`- magic bytes: ${[...magicCounts].map(([k, v]) => `${k}=${v}`).join(', ')}`);
  for (const [reason, count] of [...reasons].sort((a, b) => b[1] - a[1])) {
    summary.push(`- failure: ${count}x \`${reason}\``);
  }
  summary.push('');
}

const doc = `# Step 0 抽样清单（匿名）

本文件由 \`scripts/step0-office-sample.mts\` 生成，用于让 Step 0 的数字可被另一名评审精确复核。

**不含文件名与正文。** 每行只记录内容 SHA-256 前 12 位、扩展名、字节数、magic 类型、解析状态与行统计。

## 抽样规则（确定性）

1. 枚举 \`~/Downloads\`（\`-maxdepth 2\`），排除 \`~$\` 临时文件与隐藏路径
2. 对每个文件计算内容 SHA-256
3. **按 SHA-256 升序排序**，取前 ${SAMPLE_SIZE} 个

按内容哈希排序而非路径或 mtime，使抽样与文件系统顺序、locale 排序规则和用户私有文件名无关。同一批文件在任何机器上重跑得到同一样本。

## 汇总

${summary.join('\n')}

## 明细

| sha256[0:12] | ext | bytes | magic | parseStatus | chars | lines | medianLine |
|---|---|---|---|---|---|---|---|
${rows.join('\n')}
`;

writeFileSync('/Users/song/projects/mydocs/xiaok-cli/design/2026-08-06-step0-office-sample-manifest.md', doc, 'utf8');
console.log(summary.join('\n'));
console.log(`\nmanifest rows: ${rows.length}`);
