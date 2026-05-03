import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = join(__dirname, '..', '..', '..');

describe('sandbox preload bundle', () => {
  it('uses a self-contained CommonJS preload file for sandboxed Electron renderers', async () => {
    const preload = await readFile(join(repoRoot, 'desktop', 'electron', 'preload.cjs'), 'utf8');
    const main = await readFile(join(repoRoot, 'desktop', 'electron', 'main.ts'), 'utf8');

    expect(main).toContain('preload.cjs');
    expect(preload).toContain("require('electron')");
    expect(preload).toContain("contextBridge.exposeInMainWorld('xiaokDesktop'");
    expect(preload).not.toMatch(/\bimport\s+/);
    expect(preload).not.toMatch(/require\(['"]\.\//);
  });
});
