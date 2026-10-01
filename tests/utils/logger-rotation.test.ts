import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createLogger } from '../../src/utils/logger.js';

// Make the builtin module spy-able while keeping real implementations.
vi.mock('node:fs', async importOriginal => ({ ...await importOriginal() }));

describe('logger size cap rotation', () => {
  let dir: string;
  let logPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'xiaok-logrot-'));
    mkdirSync(join(dir, 'logs'), { recursive: true });
    logPath = join(dir, 'logs', 'xiaok.log');
    vi.stubEnv('XIAOK_CONFIG_DIR', dir);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    rmSync(dir, { recursive: true, force: true });
    for (const leftover of [join(tmpdir(), 'xiaok-recent.log'), join(tmpdir(), 'xiaok-recent.log.1')]) {
      try { rmSync(leftover, { force: true }); } catch { /* best effort */ }
    }
  });

  it('rotates to a single .1 generation when the log exceeds the cap', () => {
    vi.stubEnv('XIAOK_LOG_MAX_BYTES', '100');
    writeFileSync(logPath, 'x'.repeat(150));

    createLogger('rot').info('after cap');

    expect(fs.existsSync(`${logPath}.1`)).toBe(true);
    expect(readFileSync(`${logPath}.1`, 'utf8')).toBe('x'.repeat(150));
    const current = readFileSync(logPath, 'utf8');
    expect(current).toContain('after cap');
    expect(current).not.toContain('xxx');
  });

  it('replaces the previous .1 generation on the next rotation', () => {
    vi.stubEnv('XIAOK_LOG_MAX_BYTES', '100');
    writeFileSync(logPath, 'x'.repeat(150));
    createLogger('rot').info('first');
    writeFileSync(logPath, 'y'.repeat(150));
    createLogger('rot').info('second');

    const previous = readFileSync(`${logPath}.1`, 'utf8');
    expect(previous).toContain('y'.repeat(150));
    expect(previous).not.toContain('first');
  });

  it('does not rotate when the file is below the cap', () => {
    vi.stubEnv('XIAOK_LOG_MAX_BYTES', '1000');
    writeFileSync(logPath, 'x'.repeat(50));

    createLogger('rot').info('small');

    expect(fs.existsSync(`${logPath}.1`)).toBe(false);
    const content = readFileSync(logPath, 'utf8');
    expect(content).toContain('x'.repeat(50));
    expect(content).toContain('small');
  });

  it('falls back to truncation when rename fails', () => {
    vi.stubEnv('XIAOK_LOG_MAX_BYTES', '100');
    writeFileSync(logPath, 'x'.repeat(150));
    vi.spyOn(fs, 'renameSync').mockImplementation(() => { throw new Error('EPERM'); });

    expect(() => createLogger('rot').info('truncated path')).not.toThrow();

    expect(fs.existsSync(`${logPath}.1`)).toBe(false);
    const after = readFileSync(logPath, 'utf8');
    expect(after).toContain('truncated path');
    expect(after).not.toContain('x'.repeat(50));
  });

  it('ignores non-numeric or non-positive cap overrides and keeps writing', () => {
    for (const raw of ['abc', '-5', '0']) {
      vi.stubEnv('XIAOK_LOG_MAX_BYTES', raw);
      expect(() => createLogger('rot').info(`cap=${raw}`)).not.toThrow();
    }
    const content = readFileSync(logPath, 'utf8');
    expect(content).toContain('cap=abc');
    expect(content).toContain('cap=-5');
    expect(content).toContain('cap=0');
  });
});
