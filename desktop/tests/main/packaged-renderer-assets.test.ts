import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { build, mergeConfig, type InlineConfig } from 'vite';
import config from '../../vite.config.js';

describe('packaged renderer asset paths', () => {
  let tempDir: string | null = null;

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  it('emits relative JS and CSS URLs for Electron loadFile packaging', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'xiaok-desktop-renderer-build-'));
    const outDir = join(tempDir, 'renderer');

    await build(mergeConfig(config as InlineConfig, {
      build: {
        outDir,
        emptyOutDir: true,
      },
    }));

    const html = await readFile(join(outDir, 'index.html'), 'utf8');

    expect(html).toMatch(/\bsrc="\.\/assets\/[^"]+\.js"/);
    expect(html).toMatch(/\bhref="\.\/assets\/[^"]+\.css"/);
    expect(html).not.toMatch(/\b(?:src|href)="\/assets\//);
  });
});
