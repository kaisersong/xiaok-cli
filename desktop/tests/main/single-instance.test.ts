import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = join(__dirname, '..', '..', '..');

describe('desktop single-instance startup', () => {
  it('routes repeated launch requests to the existing app window', async () => {
    const main = await readFile(join(repoRoot, 'desktop', 'electron', 'main.ts'), 'utf8');

    expect(main).toContain('app.requestSingleInstanceLock()');
    expect(main).toContain("app.on('second-instance'");
    expect(main).toContain('restoreOrCreateWindow()');
  });
});
