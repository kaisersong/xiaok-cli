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

  it('declares shared validation and MCP spawn dependencies in both runtime manifests', async () => {
    const root = JSON.parse(await readFile(join(repoRoot, 'package.json'), 'utf8'));
    const desktop = JSON.parse(await readFile(join(repoRoot, 'desktop', 'package.json'), 'utf8'));
    for (const [name, version] of Object.entries({ ajv: '8.20.0', 'cross-spawn': '7.0.6' })) {
      expect(root.dependencies[name], `CLI ${name}`).toBe(version);
      expect(desktop.dependencies[name], `Desktop ${name}`).toBe(version);
    }
  });
});
