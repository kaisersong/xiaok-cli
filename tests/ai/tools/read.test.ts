import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createReadTool } from '../../../src/ai/tools/read.js';

describe('readTool', () => {
  let dir: string;
  let readTool: ReturnType<typeof createReadTool>;
  beforeEach(() => {
    dir = join(tmpdir(), `xiaok-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(dir, { recursive: true });
    readTool = createReadTool({ cwd: dir });
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

  it('truncates oversized output when max_chars is provided', async () => {
    writeFileSync(join(dir, 'large.txt'), Array.from({ length: 20 }, (_, index) => `line-${index + 1}`).join('\n'));

    const result = await readTool.execute({
      file_path: join(dir, 'large.txt'),
      max_chars: 60,
    });

    expect(result).toContain('已截断');
  });
});
