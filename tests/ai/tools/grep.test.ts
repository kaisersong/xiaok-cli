import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { grepTool, runFallbackGrepSearch } from '../../../src/ai/tools/grep.js';

describe('grepTool', () => {
  let dir: string;
  beforeEach(() => {
    dir = join(tmpdir(), `xiaok-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'a.txt'), 'hello world\nfoo bar\nhello again');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('finds matching lines', async () => {
    const result = await grepTool.execute({ pattern: 'hello', path: dir });
    expect(result).toContain('hello world');
    expect(result).toContain('hello again');
    expect(result).not.toContain('foo bar');
  });

  it('returns empty message when no matches', async () => {
    const result = await grepTool.execute({ pattern: 'zzznomatch', path: dir });
    expect(result).toContain('无匹配');
  });

  it('supports the pure node fallback when external grep commands are unavailable', async () => {
    const result = await runFallbackGrepSearch({ pattern: 'hello', path: dir });
    expect(result.some((line) => line.includes('hello world'))).toBe(true);
    expect(result.some((line) => line.includes('hello again'))).toBe(true);
  });
});
