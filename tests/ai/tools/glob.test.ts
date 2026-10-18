import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync, symlinkSync, utimesSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { globTool } from '../../../src/ai/tools/glob.js';

describe('globTool', () => {
  let dir: string;
  beforeEach(() => {
    dir = join(tmpdir(), `xiaok-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'src', 'a.ts'), '');
    writeFileSync(join(dir, 'src', 'b.ts'), '');
    writeFileSync(join(dir, 'README.md'), '');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('matches TypeScript files', async () => {
    const result = await globTool.execute({ pattern: '**/*.ts', path: dir });
    expect(result).toContain('a.ts');
    expect(result).toContain('b.ts');
    expect(result).not.toContain('README.md');
  });

  it('finds directories explicitly without scanning a symlink cycle', async () => {
    mkdirSync(join(dir, 'mydocs'));
    if (process.platform !== 'win32') symlinkSync(dir, join(dir, 'src', 'loop'));
    const result = await globTool.execute({ pattern: '**/mydocs', path: dir, type: 'directory' });
    expect(result).toBe(join(dir, 'mydocs').replace(/\\/g, '/'));
  });

  it('preserves newest-first ordering and supports all entry types', async () => {
    mkdirSync(join(dir, 'mydocs'));
    utimesSync(join(dir, 'src', 'a.ts'), new Date(1000), new Date(1000));
    utimesSync(join(dir, 'src', 'b.ts'), new Date(2000), new Date(2000));
    const result = await globTool.execute({ pattern: '**/*.ts', path: dir });
    expect(result.indexOf('b.ts')).toBeLessThan(result.indexOf('a.ts'));
    const all = await globTool.execute({ pattern: '*', path: dir, type: 'all' });
    expect(all).toContain(join(dir, 'mydocs').replace(/\\/g, '/'));
    expect(all).toContain('README.md');
  });

  it('supports offset and head_limit pagination', async () => {
    const result = await globTool.execute({
      pattern: '**/*.*',
      path: dir,
      offset: 1,
      head_limit: 1,
    });

    expect(result.split('\n').filter(Boolean)).toHaveLength(2);
    expect(result).toContain('offset=');
  });
});
