import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createWriteTool } from '../../../src/ai/tools/write.js';

describe('writeTool', () => {
  let dir: string;
  let writeTool: ReturnType<typeof createWriteTool>;
  beforeEach(() => {
    dir = join(tmpdir(), `xiaok-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(dir, { recursive: true });
    writeTool = createWriteTool({ cwd: dir });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('creates a new file with given content', async () => {
    const path = join(dir, 'new.ts');
    await writeTool.execute({ file_path: path, content: 'export const x = 1;' });
    expect(readFileSync(path, 'utf-8')).toBe('export const x = 1;');
  });

  it('creates parent directories automatically', async () => {
    const path = join(dir, 'deep', 'nested', 'file.ts');
    await writeTool.execute({ file_path: path, content: 'hello' });
    expect(existsSync(path)).toBe(true);
  });

  it('overwrites existing file', async () => {
    const path = join(dir, 'existing.txt');
    await writeTool.execute({ file_path: path, content: 'old' });
    await writeTool.execute({ file_path: path, content: 'new' });
    expect(readFileSync(path, 'utf-8')).toBe('new');
  });
});
