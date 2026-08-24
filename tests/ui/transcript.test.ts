import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
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

  it('writes jsonl transcript events for output and input actions', () => {
    const logger = new FileTranscriptLogger('sess_test', dir);

    logger.record({ type: 'input_key', key: '/k' });
    logger.recordOutput('stdout', '\r\x1b[2K> /kai\n');

    const filePath = join(dir, 'sess_test.jsonl');
    expect(existsSync(filePath)).toBe(true);

    const lines = readFileSync(filePath, 'utf8').trim().split('\n').map((line) => JSON.parse(line));

    expect(lines[0].type).toBe('input_key');
    expect(lines[1].type).toBe('output');
    expect(lines[1].stream).toBe('stdout');
    expect(lines[1].normalized).toBe('> /kai\n');
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

  it('drops recordOutput calls inside a suppression window', () => {
    const logger = new FileTranscriptLogger('sess_suppress', dir);

    logger.recordOutput('stdout', 'before\n');
    logger.beginSuppress();
    logger.recordOutput('stdout', '\x1b_Ga=T,f=100;QUJDRA==\x1b\\');
    logger.endSuppress();
    logger.recordOutput('stdout', 'after\n');

    const raw = readFileSync(join(dir, 'sess_suppress.jsonl'), 'utf8');
    expect(raw).toContain('before');
    expect(raw).toContain('after');
    expect(raw).not.toContain('QUJDRA==');
  });

  it('nests suppression windows with a counter', () => {
    const logger = new FileTranscriptLogger('sess_nested', dir);

    logger.beginSuppress();
    logger.beginSuppress();
    logger.endSuppress();
    logger.recordOutput('stdout', 'inner\n');
    logger.endSuppress();
    logger.recordOutput('stdout', 'outer\n');

    const raw = readFileSync(join(dir, 'sess_nested.jsonl'), 'utf8');
    expect(raw).not.toContain('inner');
    expect(raw).toContain('outer');
  });

  it('never lets the suppression depth go negative', () => {
    const logger = new FileTranscriptLogger('sess_unbalanced', dir);

    logger.endSuppress();
    logger.endSuppress();
    logger.recordOutput('stdout', 'visible\n');

    const raw = readFileSync(join(dir, 'sess_unbalanced.jsonl'), 'utf8');
    expect(raw).toContain('visible');
  });

  it('still records explicit record() events while suppressed', () => {
    const logger = new FileTranscriptLogger('sess_explicit', dir);

    logger.beginSuppress();
    logger.record({ type: 'output', stream: 'stdout', raw: '  ↳ [Image 1388×278]\n', normalized: '  ↳ [Image 1388×278]\n', timestamp: 1 });
    logger.endSuppress();

    const raw = readFileSync(join(dir, 'sess_explicit.jsonl'), 'utf8');
    expect(raw).toContain('[Image 1388×278]');
  });
});
