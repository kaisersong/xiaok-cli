import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('desktop renderer Vite config', () => {
  it('uses relative asset URLs so packaged loadFile can render the app', async () => {
    const repoRoot = join(__dirname, '..', '..', '..');
    const config = await readFile(join(repoRoot, 'desktop', 'vite.config.ts'), 'utf8');

    expect(config).toContain("base: './'");
  });
});
