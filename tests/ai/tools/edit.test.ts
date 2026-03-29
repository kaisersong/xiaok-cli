import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, readFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { editTool } from '../../../src/ai/tools/edit.js';

describe('editTool', () => {
  let dir: string;
  beforeEach(() => {
    dir = join(tmpdir(), `xiaok-test-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('replaces unique string', async () => {
    const path = join(dir, 'file.ts');
    writeFileSync(path, 'const x = 1;\nconst y = 2;');
    await editTool.execute({ file_path: path, old_string: 'const x = 1;', new_string: 'const x = 42;' });
    expect(readFileSync(path, 'utf-8')).toContain('const x = 42;');
  });

  it('returns error if old_string not found', async () => {
    const path = join(dir, 'file.ts');
    writeFileSync(path, 'hello world');
    const result = await editTool.execute({ file_path: path, old_string: 'not here', new_string: 'x' });
    expect(result).toContain('Error');
  });

  it('returns error if old_string appears more than once', async () => {
    const path = join(dir, 'file.ts');
    writeFileSync(path, 'foo\nfoo\n');
    const result = await editTool.execute({ file_path: path, old_string: 'foo', new_string: 'bar' });
    expect(result).toContain('Error');
    expect(result).toContain('2');
  });
});
