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
