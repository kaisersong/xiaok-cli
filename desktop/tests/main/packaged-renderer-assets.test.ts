import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('packaged renderer asset paths', () => {
  it('keeps the packaged renderer config on relative paths for Electron loadFile packaging', async () => {
    const repoRoot = join(__dirname, '..', '..', '..');
    const viteConfig = await readFile(join(repoRoot, 'desktop', 'vite.config.ts'), 'utf8');

    expect(viteConfig).toContain("base: './'");
    expect(viteConfig).toContain("root: 'renderer'");
    expect(viteConfig).toContain("outDir: '../dist/renderer'");
  });
});
