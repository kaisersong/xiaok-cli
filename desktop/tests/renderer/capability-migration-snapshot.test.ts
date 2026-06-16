import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const preloadSource = readFileSync(join(import.meta.dirname, '..', '..', 'electron', 'preload.cjs'), 'utf8');

function extractPreloadApiKeys(source: string): string[] {
  const keys: string[] = [];
  const bodyMatch = source.match(/contextBridge\.exposeInMainWorld\('xiaokDesktop',\s*\{([\s\S]*)\}\s*\)/);
  if (!bodyMatch) return keys;
  const body = bodyMatch[1];
  const propMatches = body.matchAll(/^\s+(\w+)\s*[:(]/gm);
  for (const m of propMatches) {
    keys.push(m[1]);
  }
  return keys.sort();
}

describe('preload API surface snapshot (Stage 5.5)', () => {
  const keys = extractPreloadApiKeys(preloadSource);

  it('has a known set of flat preload API keys', () => {
    expect(keys.length).toBeGreaterThan(50);
  });

  it('includes showSaveDialog and saveFile (pre-migration state)', () => {
    expect(keys).toContain('showSaveDialog');
    expect(keys).toContain('saveFile');
  });

  it('includes readFileContent (pre-migration state, currently takes filePath)', () => {
    expect(keys).toContain('readFileContent');
  });

  it('tracks the current legacy flat key count for regression', () => {
    expect(keys.length).toMatchInlineSnapshot(`159`);
  });

  it('showSaveDialog currently passes input directly (pre-capabilityToken)', () => {
    expect(preloadSource).toContain("showSaveDialog: (input) => ipcRenderer.invoke('desktop:showSaveDialog', input)");
  });

  it('saveFile currently passes input directly (pre-capabilityToken)', () => {
    expect(preloadSource).toContain("saveFile: (input) => ipcRenderer.invoke('desktop:saveFile', input)");
  });

  it('readFileContent wraps filePath in object (already adapted)', () => {
    expect(preloadSource).toContain("readFileContent: (filePath) => ipcRenderer.invoke('desktop:readFileContent', { filePath })");
  });
});
