import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileTranscriptLogger } from '../../src/ui/transcript.js';

describe('transcript output size cap', () => {
  let transcriptDir: string;
  let configDir: string;

  beforeEach(() => {
    transcriptDir = mkdtempSync(join(tmpdir(), 'xiaok-transcript-cap-'));
    configDir = mkdtempSync(join(tmpdir(), 'xiaok-transcript-cap-config-'));
    vi.stubEnv('XIAOK_CONFIG_DIR', configDir);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(transcriptDir, { recursive: true, force: true });
    rmSync(configDir, { recursive: true, force: true });
  });

  function transcriptPath(sessionId: string): string {
    return join(transcriptDir, `${sessionId}.jsonl`);
  }

  it('drops output events after the cap while structural events keep recording', async () => {
    vi.stubEnv('XIAOK_TRANSCRIPT_MAX_BYTES', '100');
    const logger = await FileTranscriptLogger.open('sess_cap', transcriptDir);
    const path = transcriptPath('sess_cap');

    writeFileSync(path, '{"type":"input_key","key":"pad","timestamp":1}\n'.repeat(8));
    const sizeBefore = statSync(path).size;

    logger.recordOutput('stdout', 'overflowing chunk');
    logger.record({ type: 'input_key', key: '/k' });

    expect(statSync(path).size).toBeGreaterThan(sizeBefore);
    const lines = readFileSync(path, 'utf8').trim().split('\n');
    const last = JSON.parse(lines[lines.length - 1]);
    expect(last.type).toBe('input_key');
    expect(readFileSync(path, 'utf8')).not.toContain('overflowing chunk');
    logger.close();
  });

  it('records output normally below the cap', async () => {
    vi.stubEnv('XIAOK_TRANSCRIPT_MAX_BYTES', '1000');
    const logger = await FileTranscriptLogger.open('sess_below', transcriptDir);

    logger.recordOutput('stdout', 'normal chunk');

    expect(readFileSync(transcriptPath('sess_below'), 'utf8')).toContain('normal chunk');
    logger.close();
  });

  it('warns exactly once per session when the cap trips', async () => {
    vi.stubEnv('XIAOK_TRANSCRIPT_MAX_BYTES', '100');
    const logger = await FileTranscriptLogger.open('sess_warn', transcriptDir);
    writeFileSync(transcriptPath('sess_warn'), 'x'.repeat(200));

    logger.recordOutput('stdout', 'one');
    logger.recordOutput('stdout', 'two');
    logger.recordOutput('stderr', 'three');

    const appLog = join(configDir, 'logs', 'xiaok.log');
    expect(existsSync(appLog)).toBe(true);
    const warnings = readFileSync(appLog, 'utf8')
      .split('\n')
      .filter((line) => line.includes('transcript output recording disabled'));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('sess_warn');
    logger.close();
  });
});
