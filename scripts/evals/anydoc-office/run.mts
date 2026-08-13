import { createHash } from 'node:crypto';
import {
  closeSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { createChunker } from '../../../desktop/electron/kb-chunker.ts';
import { createKbRetriever } from '../../../desktop/electron/kb-retrieval.ts';
import { createSourceExtractor } from '../../../desktop/electron/kb-source-extractor.ts';
import { createKbStoreSqlite } from '../../../desktop/electron/kb-store-sqlite.ts';
import { createKbTools } from '../../../desktop/electron/kb-tools.ts';
import { createOfficeDocumentParser } from '../../../desktop/electron/office-document-parser.ts';
import type { KbStore, SourceExtractor } from '../../../desktop/electron/kb-store.ts';
import { extractMaterialText } from '../../../src/runtime/materials/text-extractor.ts';
import {
  getDocumentMimeType,
  officeFormatForPath,
} from '../../../src/runtime/materials/document-formats.ts';

type Family = 'word' | 'presentation' | 'spreadsheet';
type StableStatus = 'parsed' | 'failed' | 'unsupported';

interface CorpusFile {
  absolutePath: string;
  bytes: number;
  extension: string;
  family: Family;
  hash: string;
  magic: string;
}

interface ParseObservation {
  anydocChars: number;
  anydocCode?: string;
  anydocStatus: StableStatus;
  baselineChars: number;
  baselineCode?: string;
  baselineStatus: StableStatus;
  bytes: number;
  extension: string;
  family: Family;
  hashPrefix: string;
  magic: string;
  totalMs: number;
}

interface FrozenQuery {
  id: string;
  family: Family;
  kind: 'answer' | 'no_answer';
  query: string;
  expectedSourceHashes: string[];
}

const ROOT = resolve(import.meta.dirname, '..', '..', '..');
const DEFAULT_CORPUS_ROOT = join(homedir(), 'Downloads');
const DEFAULT_QUERY_PATH = join(import.meta.dirname, 'queries.json');
const DEFAULT_OUTPUT_PATH = join(ROOT, '.xiaok', 'evals', 'anydoc-office', 'latest.json');
const SAMPLE_SIZE = 40;
const MAX_OUTPUT_CHARS = 16_000_001;
const FAMILY_BY_EXTENSION: Readonly<Record<string, Family>> = {
  '.doc': 'word', '.docx': 'word', '.docm': 'word',
  '.ppt': 'presentation', '.pps': 'presentation', '.pot': 'presentation',
  '.pptx': 'presentation', '.pptm': 'presentation', '.ppsx': 'presentation', '.ppsm': 'presentation',
  '.xls': 'spreadsheet', '.xlsx': 'spreadsheet', '.xlsm': 'spreadsheet', '.xlsb': 'spreadsheet',
};

const args = parseArgs(process.argv.slice(2));
const corpusRoot = resolve(args['corpus-root'] ?? process.env.ANYDOC_OFFICE_CORPUS_ROOT ?? DEFAULT_CORPUS_ROOT);
const outputPath = resolve(args.output ?? DEFAULT_OUTPUT_PATH);
const queryPaths = [DEFAULT_QUERY_PATH, ...(args.queries ? [resolve(args.queries)] : [])];
const officeParser = createOfficeDocumentParser({
  workerPath: join(ROOT, 'desktop', 'electron', 'office-parser-worker.mjs'),
});

const corpus = selectCorpus(corpusRoot);
if (corpus.length === 0) throw new Error(`No Office corpus files found under ${corpusRoot}`);

const observations: ParseObservation[] = [];
if (args.mode !== 'retrieval') {
  for (const file of corpus) {
    observations.push(await observeParse(file));
  }
}

const queries = queryPaths.flatMap(loadQueries);
const retrieval = queries.length > 0 ? await runRetrievalEval(corpus, queries) : undefined;
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  corpusRootHash: sha256(corpusRoot),
  selection: {
    rule: 'content-sha256-ascending-per-extension',
    sampleSizePerExtension: SAMPLE_SIZE,
    files: observations.length,
  },
  aggregate: observations.length > 0 ? aggregateObservations(observations) : undefined,
  observations,
  retrieval,
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify({ outputPath, aggregate: report.aggregate, retrieval }, null, 2)}\n`);

async function observeParse(file: CorpusFile): Promise<ParseObservation> {
  const baseline = await extractMaterialText({
    workspacePath: file.absolutePath,
    mimeType: getDocumentMimeType(file.extension) ?? 'application/octet-stream',
    maxChars: MAX_OUTPUT_CHARS,
  });
  const startedAt = performance.now();
  const anydoc = await officeParser.parse({
    absolutePath: file.absolutePath,
    maxOutputChars: MAX_OUTPUT_CHARS,
  });
  const totalMs = performance.now() - startedAt;
  return {
    anydocChars: anydoc.ok ? anydoc.chars : 0,
    anydocCode: anydoc.ok ? undefined : anydoc.code,
    anydocStatus: anydoc.ok && anydoc.markdown.trim() ? 'parsed' : anydoc.ok ? 'failed' : statusForCode(anydoc.code),
    baselineChars: baseline.text?.length ?? 0,
    baselineCode: baseline.errorCode ?? baseline.parseStatus,
    baselineStatus: baseline.parseStatus,
    bytes: file.bytes,
    extension: file.extension,
    family: file.family,
    hashPrefix: file.hash.slice(0, 12),
    magic: file.magic,
    totalMs: round(totalMs),
  };
}

function selectCorpus(root: string): CorpusFile[] {
  const selected: CorpusFile[] = [];
  for (const extension of Object.keys(FAMILY_BY_EXTENSION)) {
    const paths = findByExtension(root, extension);
    const hashed = paths.map(absolutePath => ({
      absolutePath,
      hash: sha256(readFileSync(absolutePath)),
    })).sort((left, right) => left.hash.localeCompare(right.hash));
    for (const item of hashed.slice(0, SAMPLE_SIZE)) {
      selected.push({
        ...item,
        bytes: statSync(item.absolutePath).size,
        extension,
        family: FAMILY_BY_EXTENSION[extension],
        magic: magicKind(item.absolutePath),
      });
    }
  }
  return selected;
}

function findByExtension(root: string, extension: string): string[] {
  const matches: string[] = [];
  for (const topLevel of readdirSync(root, { withFileTypes: true })) {
    if (topLevel.name.startsWith('.')) continue;
    const topLevelPath = join(root, topLevel.name);
    if (topLevel.isFile()) {
      if (!topLevel.name.startsWith('~$') && extname(topLevel.name).toLowerCase() === extension) matches.push(topLevelPath);
      continue;
    }
    if (!topLevel.isDirectory()) continue;
    for (const secondLevel of readdirSync(topLevelPath, { withFileTypes: true })) {
      if (!secondLevel.isFile() || secondLevel.name.startsWith('.') || secondLevel.name.startsWith('~$')) continue;
      if (extname(secondLevel.name).toLowerCase() === extension) matches.push(join(topLevelPath, secondLevel.name));
    }
  }
  return matches;
}

function magicKind(filePath: string): string {
  const fd = openSync(filePath, 'r');
  const buffer = Buffer.alloc(8);
  readSync(fd, buffer, 0, buffer.length, 0);
  closeSync(fd);
  const hex = buffer.toString('hex');
  if (hex.startsWith('504b0304')) return 'zip';
  if (hex.startsWith('d0cf11e0a1b11ae1')) return 'ole2';
  return `other:${hex.slice(0, 8)}`;
}

function loadQueries(filePath: string): FrozenQuery[] {
  const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as unknown;
  if (!Array.isArray(parsed)) throw new Error(`Query file must be an array: ${filePath}`);
  return parsed.map((value, index) => validateQuery(value, `${filePath}#${index}`));
}

function validateQuery(value: unknown, label: string): FrozenQuery {
  if (!value || typeof value !== 'object') throw new Error(`Invalid frozen query: ${label}`);
  const record = value as Record<string, unknown>;
  if (typeof record.id !== 'string' || typeof record.query !== 'string') throw new Error(`Invalid frozen query: ${label}`);
  if (!['word', 'presentation', 'spreadsheet'].includes(String(record.family))) throw new Error(`Invalid frozen query family: ${label}`);
  if (record.kind !== 'answer' && record.kind !== 'no_answer') throw new Error(`Invalid frozen query kind: ${label}`);
  if (!Array.isArray(record.expectedSourceHashes) || !record.expectedSourceHashes.every(hash => typeof hash === 'string')) {
    throw new Error(`Invalid expectedSourceHashes: ${label}`);
  }
  return record as unknown as FrozenQuery;
}

async function runRetrievalEval(files: CorpusFile[], queries: FrozenQuery[]) {
  const requiredHashes = new Set(queries.flatMap(query => query.expectedSourceHashes));
  const selectedFiles = files.filter(file => requiredHashes.has(file.hash) || requiredHashes.has(file.hash.slice(0, 12)));
  const missing = [...requiredHashes].filter(hash => !selectedFiles.some(file => file.hash === hash || file.hash.startsWith(hash)));
  if (missing.length > 0) throw new Error(`Frozen queries reference missing source hashes: ${missing.join(', ')}`);

  const baseline = await buildRetrievalIndex(selectedFiles, createSourceExtractor());
  const anydoc = await buildRetrievalIndex(selectedFiles, createSourceExtractor({ officeParser }));
  try {
    const rows = [];
    for (const query of queries) {
      const baselineRanks = await searchRanks(baseline, query);
      const anydocRanks = await searchRanks(anydoc, query);
      rows.push({
        id: query.id,
        family: query.family,
        kind: query.kind,
        queryHash: sha256(query.query).slice(0, 12),
        baselineRank: bestExpectedRank(baselineRanks, query.expectedSourceHashes),
        anydocRank: bestExpectedRank(anydocRanks, query.expectedSourceHashes),
        baselineFalseRecall: query.kind === 'no_answer' && baselineRanks.length > 0,
        anydocFalseRecall: query.kind === 'no_answer' && anydocRanks.length > 0,
      });
    }
    return { aggregate: aggregateRetrieval(rows), rows };
  } finally {
    baseline.store.close();
    anydoc.store.close();
    removeSqliteFiles(baseline.dbPath);
    removeSqliteFiles(anydoc.dbPath);
  }
}

async function buildRetrievalIndex(files: CorpusFile[], extractor: SourceExtractor) {
  const dbPath = join(tmpdir(), `xiaok-anydoc-eval-${process.pid}-${Math.random().toString(36).slice(2)}.db`);
  const store = createKbStoreSqlite(dbPath);
  const collection = store.createCollection({ name: 'eval', embeddingModelId: 'none', embeddingDim: 1 });
  const chunker = createChunker();
  for (const file of files) {
    const source = store.addSource({
      collectionId: collection.id,
      kind: 'file',
      title: file.hash.slice(0, 12),
      filePath: file.absolutePath,
      mimeType: getDocumentMimeType(file.extension),
    }, 'scheduler');
    const extracted = await extractor.extract({
      filePath: file.absolutePath,
      mimeType: getDocumentMimeType(file.extension) ?? 'application/octet-stream',
    });
    if (extracted.ok && extracted.text) {
      store.insertChunks(source.id, chunker.chunk({ text: extracted.text, mimeType: extracted.mimeType }));
      store.updateSourceParseResult(source.id, { parseStatus: 'parsed' }, 'scheduler');
    } else {
      store.updateSourceParseResult(source.id, {
        parseStatus: extracted.errorCode === 'unsupported_format' ? 'unsupported' : 'failed',
        errorCode: extracted.errorCode,
        errorMessage: extracted.error,
      }, 'scheduler');
    }
  }
  const retriever = createKbRetriever({ db: (store as KbStore & { _db: never })._db!, embedFn: () => null });
  const searchTool = createKbTools(store, retriever).find(tool => tool.definition.name === 'kb_search')!;
  return { collectionId: collection.id, dbPath, searchTool, store };
}

async function searchRanks(index: Awaited<ReturnType<typeof buildRetrievalIndex>>, query: FrozenQuery): Promise<string[]> {
  const output = await index.searchTool.execute({
    collection_id: index.collectionId,
    query: query.query,
    top_k: 5,
  });
  return String(output).split('\n').flatMap(line => {
    const match = line.match(/^\d+\. 「([a-f0-9]{12})」/);
    return match ? [match[1]] : [];
  });
}

function bestExpectedRank(ranks: string[], expected: string[]): number | null {
  if (expected.length === 0) return null;
  const rank = ranks.findIndex(hash => expected.some(target => target.startsWith(hash) || hash.startsWith(target)));
  return rank >= 0 ? rank + 1 : null;
}

function aggregateObservations(rows: ParseObservation[]) {
  const byExtension = Object.fromEntries(Object.keys(FAMILY_BY_EXTENSION).map(extension => {
    const bucket = rows.filter(row => row.extension === extension);
    return [extension, {
      total: bucket.length,
      baselineParsed: bucket.filter(row => row.baselineStatus === 'parsed' && row.baselineChars > 0).length,
      anydocParsed: bucket.filter(row => row.anydocStatus === 'parsed' && row.anydocChars > 0).length,
      anydocFailures: countBy(bucket.filter(row => row.anydocStatus !== 'parsed').map(row => row.anydocCode ?? row.anydocStatus)),
    }];
  }));
  const small = rows.filter(row => row.bytes <= 10 * 1024 * 1024).map(row => row.totalMs);
  const large = rows.filter(row => row.bytes > 10 * 1024 * 1024).map(row => row.totalMs);
  return {
    byExtension,
    performance: {
      small: summarizeDurations(small),
      large: summarizeDurations(large),
    },
  };
}

function aggregateRetrieval(rows: Array<{ family: Family; kind: string; baselineRank: number | null; anydocRank: number | null; baselineFalseRecall: boolean; anydocFalseRecall: boolean }>) {
  return Object.fromEntries((['word', 'presentation', 'spreadsheet'] as Family[]).map(family => {
    const answerRows = rows.filter(row => row.family === family && row.kind === 'answer');
    const noAnswerRows = rows.filter(row => row.family === family && row.kind === 'no_answer');
    return [family, {
      queries: answerRows.length,
      baselineHitAt5: ratio(answerRows.filter(row => row.baselineRank !== null).length, answerRows.length),
      anydocHitAt5: ratio(answerRows.filter(row => row.anydocRank !== null).length, answerRows.length),
      baselineMrr: mean(answerRows.map(row => row.baselineRank ? 1 / row.baselineRank : 0)),
      anydocMrr: mean(answerRows.map(row => row.anydocRank ? 1 / row.anydocRank : 0)),
      baselineFalseRecall: ratio(noAnswerRows.filter(row => row.baselineFalseRecall).length, noAnswerRows.length),
      anydocFalseRecall: ratio(noAnswerRows.filter(row => row.anydocFalseRecall).length, noAnswerRows.length),
    }];
  }));
}

function summarizeDurations(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    count: sorted.length,
    medianMs: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
    maxMs: sorted.length ? round(sorted[sorted.length - 1]) : null,
  };
}

function percentile(sorted: number[], percentileValue: number): number | null {
  if (sorted.length === 0) return null;
  return round(sorted[Math.ceil(sorted.length * percentileValue) - 1]);
}

function statusForCode(code: string): StableStatus {
  return code === 'unsupported_format' ? 'unsupported' : 'failed';
}

function countBy(values: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? round(numerator / denominator) : null;
}

function mean(values: number[]): number | null {
  return values.length ? round(values.reduce((sum, value) => sum + value, 0) / values.length) : null;
}

function round(value: number): number {
  return Number(value.toFixed(3));
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function parseArgs(argv: string[]): Record<string, string> {
  const parsed: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for --${key}`);
    parsed[key] = value;
    index += 1;
  }
  return parsed;
}

function removeSqliteFiles(dbPath: string): void {
  for (const suffix of ['', '-shm', '-wal']) {
    rmSync(`${dbPath}${suffix}`, { force: true });
  }
}
