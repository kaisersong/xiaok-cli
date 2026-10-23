import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { FULL_PRELOAD_KEYS } from '../../electron/preload-api';

const frozenKeys = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'fixtures', 'preload-integration-frozen-keys.json'), 'utf8')) as {main: string[]; closure: string[]};

const preloadSource = readFileSync(join(import.meta.dirname, '..', '..', 'electron', 'preload.cjs'), 'utf8');

function extractPreloadApiKeys(source: string): string[] {
  let exposed: object | undefined;
  runInNewContext(source, {
    require: (name: string) => {
      if (name === 'electron') return {
        contextBridge: { exposeInMainWorld: (key: string, api: object) => {
          expect(key).toBe('xiaokDesktop');
          expect(exposed).toBeUndefined();
          exposed = api;
        } },
        ipcRenderer: {},
      };
      if (name === 'os') return { userInfo: () => ({ username: 'preload-fixture' }) };
      throw new Error(`unexpected preload module: ${name}`);
    },
  });
  expect(exposed).toBeDefined();
  return Object.keys(exposed!).sort();
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
    // Goal Mode adds only semantic lifecycle, attachment-ack, queue-priority,
    // and event subscription operations. It does not expose store, arbitrary
    // status mutation, task start, or caller-controlled authority fields.
    // Room workspace adds 11 semantic configuration, file projection, and
    // artifact operations; it does not expose generic filesystem access.
    // Native Goal/publication, Loop publication and observation add only
    // semantic commands; the canonical allowlist and real bridge must agree.
    expect(frozenKeys.main).toHaveLength(295);
    expect(frozenKeys.closure).toHaveLength(307);
    const union = [...new Set([...frozenKeys.main, ...frozenKeys.closure])].sort();
    expect(keys).toEqual(union);
    expect([...FULL_PRELOAD_KEYS].sort()).toEqual(union);
    expect(new Set(FULL_PRELOAD_KEYS).size).toBe(FULL_PRELOAD_KEYS.length);
    expect(keys.length).toMatchInlineSnapshot(`310`);
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
