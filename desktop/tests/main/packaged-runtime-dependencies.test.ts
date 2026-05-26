import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = join(__dirname, '..', '..', '..');

describe('packaged runtime dependencies', () => {
  it('keeps model adapter SDKs in desktop production dependencies', async () => {
    const pkg = JSON.parse(await readFile(join(repoRoot, 'desktop', 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    expect(pkg.dependencies?.['openai']).toBeDefined();
    expect(pkg.dependencies?.['@anthropic-ai/sdk']).toBeDefined();
    expect(pkg.devDependencies?.['@anthropic-ai/sdk']).toBeUndefined();
  });
});
