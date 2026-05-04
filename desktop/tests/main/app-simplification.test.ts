import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = join(__dirname, '..', '..', '..');

async function readAllSrcFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const contents: string[] = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      contents.push(...await readAllSrcFiles(fullPath));
    } else if (entry.name.endsWith('.tsx') || entry.name.endsWith('.ts') || entry.name.endsWith('.css')) {
      contents.push(await readFile(fullPath, 'utf8'));
    }
  }
  return contents;
}

describe('desktop simplified interaction', () => {
  it('uses HashRouter for Electron file:// compatibility', async () => {
    const main = await readFile(join(repoRoot, 'desktop', 'renderer', 'src', 'main.tsx'), 'utf8');
    expect(main).toContain('HashRouter');
    expect(main).toContain('React.StrictMode');
    expect(main).toContain('AuthProvider');
  });

  it('has no arkloop/arktool references in renderer source', async () => {
    const contents = await readAllSrcFiles(join(repoRoot, 'desktop', 'renderer', 'src'));
    for (const content of contents) {
      expect(content.toLowerCase()).not.toContain('arkloop');
      expect(content.toLowerCase()).not.toContain('arktool');
    }
  });

  it('has no arkloop/arktool references in electron source', async () => {
    const contents = await readAllSrcFiles(join(repoRoot, 'desktop', 'electron'));
    for (const content of contents) {
      expect(content.toLowerCase()).not.toContain('arkloop');
      expect(content.toLowerCase()).not.toContain('arktool');
    }
  });
});