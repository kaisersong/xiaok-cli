import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  analyzeTranscriptFileStreaming,
  analyzeTranscriptEvents,
  FileTranscriptLogger,
  normalizeTranscriptChunk,
} from '../../src/ui/transcript.js';

describe('transcript logger', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'xiaok-transcript-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('normalizes ansi output for analysis', () => {
    expect(normalizeTranscriptChunk('\r\x1b[2K\x1b[36m> /ka\x1b[0m\n')).toBe('> /ka\n');
  });

  it('writes jsonl transcript events for output and input actions', async () => {
    const logger = await FileTranscriptLogger.open('sess_test', dir);

    logger.record({ type: 'input_key', key: '/k' });
    logger.recordOutput('stdout', '\r\x1b[2K> /kai\n');

    const filePath = join(dir, 'sess_test.jsonl');
    expect(existsSync(filePath)).toBe(true);

    const lines = readFileSync(filePath, 'utf8').trim().split('\n').map((line) => JSON.parse(line));

    expect(lines[0].type).toBe('input_key');
    expect(lines[1].type).toBe('output');
    expect(lines[1].stream).toBe('stdout');
    expect(lines[1].normalized).toBe('> /kai\n');
    logger.close();
  });

  it('detects repeated prompt growth and repeated approval titles from normalized output', () => {
    const analysis = analyzeTranscriptEvents([
      { type: 'output', stream: 'stdout', raw: '> /\n', normalized: '> /\n', timestamp: 1 },
      { type: 'output', stream: 'stdout', raw: '> /k\n', normalized: '> /k\n', timestamp: 2 },
      { type: 'output', stream: 'stdout', raw: '> /ka\n', normalized: '> /ka\n', timestamp: 3 },
      { type: 'output', stream: 'stdout', raw: '⚡ xiaok 想要执行以下操作\n', normalized: '⚡ xiaok 想要执行以下操作\n', timestamp: 4 },
      { type: 'output', stream: 'stdout', raw: '⚡ xiaok 想要执行以下操作\n', normalized: '⚡ xiaok 想要执行以下操作\n', timestamp: 5 },
    ]);

    expect(analysis.slashPromptGrowth).toBe(2);
    expect(analysis.approvalTitleRepeats).toBe(1);
    expect(analysis.eventCount).toBe(5);
    expect(analysis.warnings).toEqual([]);
  });

  it('streams the production transcript file with array-equivalent analysis', async () => {
    const events = [
      { type: 'output', stream: 'stdout', raw: '> /\n', normalized: '> /\n', timestamp: 1 },
      { type: 'input_key', key: 'k', timestamp: 2 },
      { type: 'output', stream: 'stdout', raw: '> /k\n', normalized: '> /k\n', timestamp: 3 },
      { type: 'output', stream: 'stdout', raw: '⚡ xiaok 想要执行以下操作\n', normalized: '⚡ xiaok 想要执行以下操作\n', timestamp: 4 },
      { type: 'output', stream: 'stdout', raw: '⚡ xiaok 想要执行以下操作\n', normalized: '⚡ xiaok 想要执行以下操作\n', timestamp: 5 },
    ] as const;
    const filePath = join(dir, 'sess_stream.jsonl');
    const text = events.map(event => JSON.stringify(event)).join('\r\n');
    writeFileSync(filePath, text, 'utf8');

    await expect(analyzeTranscriptFileStreaming('sess_stream', dir)).resolves.toEqual(
      analyzeTranscriptEvents([...events]),
    );
  });

  it('accepts a complete final line without newline and warns only for an incomplete tail', async () => {
    const complete = JSON.stringify({ type: 'input_key', key: 'x', timestamp: 1 });
    writeFileSync(join(dir, 'sess_complete.jsonl'), complete, 'utf8');
    await expect(analyzeTranscriptFileStreaming('sess_complete', dir)).resolves.toMatchObject({
      eventCount: 1,
      warnings: [],
    });

    writeFileSync(
      join(dir, 'sess_truncated.jsonl'),
      `${complete}\n{\"type\":\"output\"`,
      'utf8',
    );
    await expect(analyzeTranscriptFileStreaming('sess_truncated', dir)).resolves.toMatchObject({
      eventCount: 1,
      warnings: [{ code: 'truncatedTail' }],
    });
  });

  it('fails closed for malformed JSON before EOF', async () => {
    writeFileSync(
      join(dir, 'sess_corrupt.jsonl'),
      '{bad json}\n' + JSON.stringify({ type: 'input_key', key: 'x', timestamp: 1 }),
      'utf8',
    );

    await expect(analyzeTranscriptFileStreaming('sess_corrupt', dir)).rejects.toThrow('invalid transcript JSON at line 1');
  });
});

describe('transcript logger output suppression', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'xiaok-transcript-suppress-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('drops recordOutput calls inside a suppression window', async () => {
    const logger = await FileTranscriptLogger.open('sess_suppress', dir);

    logger.recordOutput('stdout', 'before\n');
    logger.beginSuppress();
    logger.recordOutput('stdout', '\x1b_Ga=T,f=100;QUJDRA==\x1b\\');
    logger.endSuppress();
    logger.recordOutput('stdout', 'after\n');

    const raw = readFileSync(join(dir, 'sess_suppress.jsonl'), 'utf8');
    expect(raw).toContain('before');
    expect(raw).toContain('after');
    expect(raw).not.toContain('QUJDRA==');
    logger.close();
  });

  it('nests suppression windows with a counter', async () => {
    const logger = await FileTranscriptLogger.open('sess_nested', dir);

    logger.beginSuppress();
    logger.beginSuppress();
    logger.endSuppress();
    logger.recordOutput('stdout', 'inner\n');
    logger.endSuppress();
    logger.recordOutput('stdout', 'outer\n');

    const raw = readFileSync(join(dir, 'sess_nested.jsonl'), 'utf8');
    expect(raw).not.toContain('inner');
    expect(raw).toContain('outer');
    logger.close();
  });

  it('never lets the suppression depth go negative', async () => {
    const logger = await FileTranscriptLogger.open('sess_unbalanced', dir);

    logger.endSuppress();
    logger.endSuppress();
    logger.recordOutput('stdout', 'visible\n');

    const raw = readFileSync(join(dir, 'sess_unbalanced.jsonl'), 'utf8');
    expect(raw).toContain('visible');
    logger.close();
  });

  it('still records explicit record() events while suppressed', async () => {
    const logger = await FileTranscriptLogger.open('sess_explicit', dir);

    logger.beginSuppress();
    logger.record({ type: 'output', stream: 'stdout', raw: '  ↳ [Image 1388×278]\n', normalized: '  ↳ [Image 1388×278]\n', timestamp: 1 });
    logger.endSuppress();

    const raw = readFileSync(join(dir, 'sess_explicit.jsonl'), 'utf8');
    expect(raw).toContain('[Image 1388×278]');
    logger.close();
  });
});
