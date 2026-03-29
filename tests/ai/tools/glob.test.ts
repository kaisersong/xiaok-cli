import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
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
});
