import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const desktopRoot = join(__dirname, '..', '..');

describe('Office parser packaging contract', () => {
  it('pins AnyDoc and copies the one-shot worker into the compiled main tree', () => {
    const pkg = JSON.parse(readFileSync(join(desktopRoot, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
      scripts: Record<string, string>;
    };
    expect(pkg.dependencies['@firecrawl/anydoc']).toBe('0.1.8');
    expect(pkg.scripts['build:main']).toContain('office-parser-worker.mjs');
  });

  it('unpacks the worker, AnyDoc loader and platform native packages from asar', () => {
    const config = JSON.parse(readFileSync(join(desktopRoot, 'electron-builder.json'), 'utf8')) as {
      asarUnpack?: string[];
    };
    expect(config.asarUnpack).toEqual(expect.arrayContaining([
      'dist/main/desktop/electron/office-parser-worker.mjs',
      '**/node_modules/@firecrawl/anydoc/**',
      '**/node_modules/@firecrawl/anydoc-*/**',
    ]));
  });

  it('finds the compiled worker after build:main', () => {
    expect(existsSync(join(desktopRoot, 'dist', 'main', 'desktop', 'electron', 'office-parser-worker.mjs'))).toBe(true);
  });
});
