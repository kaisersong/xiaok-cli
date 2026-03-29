import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { readTool } from '../../../src/ai/tools/read.js';

describe('readTool', () => {
  let dir: string;
  beforeEach(() => {
    dir = join(tmpdir(), `xiaok-test-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('reads file with line numbers', async () => {
    writeFileSync(join(dir, 'foo.txt'), 'line1\nline2\nline3');
    const result = await readTool.execute({ file_path: join(dir, 'foo.txt') });
    expect(result).toContain('1\tline1');
    expect(result).toContain('2\tline2');
  });

  it('returns error message for missing file', async () => {
    const result = await readTool.execute({ file_path: join(dir, 'missing.txt') });
    expect(result).toContain('Error');
  });
});
