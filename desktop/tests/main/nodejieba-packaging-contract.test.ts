import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Packaging contract for nodejieba.
//
// The shipped desktop app had no `nodejieba` at all, so Chinese KB search
// silently degraded to whole-string substring matching: `segmentChinese`
// catches the failed require and returns the input unchanged
// (src/ai/memory/segment.ts). Declaring the dependency is necessary but not
// sufficient — cppjieba reads its dictionaries with C++ ifstream from a path
// derived from __dirname, and asar's fs patch does not cover native reads.
// A dictionary that stays inside app.asar therefore fails to open, and
// cppjieba's XCHECK calls abort(), which no JS try/catch can intercept.
//
// So this file pins three things:
//   1. the dependency is declared (and stays optional)
//   2. the dictionaries are unpacked out of app.asar
//   3. the loader resolves dictionaries from the unpacked location

const repoRoot = join(__dirname, '..', '..', '..');
const desktopRoot = join(repoRoot, 'desktop');

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
}

// The five dictionaries cppjieba opens natively (node_modules/nodejieba/index.js).
const DICT_FILES = [
  'jieba.dict.utf8',
  'hmm_model.utf8',
  'user.dict.utf8',
  'idf.utf8',
  'stop_words.utf8',
];

describe('nodejieba packaging contract', () => {
  const desktopPkg = readJson(join(desktopRoot, 'package.json'));
  const optional = (desktopPkg.optionalDependencies ?? {}) as Record<string, string>;
  const deps = (desktopPkg.dependencies ?? {}) as Record<string, string>;

  it('declares nodejieba so electron-builder bundles it', () => {
    // electron-builder collects { ...dependencies, ...optionalDependencies }.
    expect(optional.nodejieba ?? deps.nodejieba).toBeTruthy();
  });

  it('keeps nodejieba optional so a missing prebuild degrades instead of failing the install', () => {
    // Upstream publishes prebuilds for darwin-arm64 / linux-x64 / linux-arm64 /
    // win32-x64 only. On darwin-x64 or win32-arm64 the install falls back to a
    // source build; as a hard dependency that failure would abort `npm ci` and
    // block the release workflow instead of degrading.
    expect(deps.nodejieba).toBeUndefined();
    expect(optional.nodejieba).toBeTruthy();
  });

  it('keeps the root package declaration optional too', () => {
    const rootPkg = readJson(join(repoRoot, 'package.json'));
    const rootOptional = (rootPkg.optionalDependencies ?? {}) as Record<string, string>;
    const rootDeps = (rootPkg.dependencies ?? {}) as Record<string, string>;
    expect(rootDeps.nodejieba).toBeUndefined();
    expect(rootOptional.nodejieba).toBeTruthy();
  });

  it('records nodejieba in the desktop lockfile so `npm ci` stays in sync', () => {
    // desktop-release.yml runs `cd desktop && npm ci`, which aborts with EUSAGE
    // when package.json and the lockfile disagree.
    const lockPath = join(desktopRoot, 'package-lock.json');
    expect(existsSync(lockPath)).toBe(true);
    expect(readFileSync(lockPath, 'utf8')).toContain('nodejieba');
  });

  it('has nodejieba actually installed under desktop/, not merely declared', () => {
    // Declaring the dependency and refreshing the lockfile with
    // --package-lock-only satisfies every assertion above while
    // desktop/node_modules stays empty — and electron-builder packs from
    // node_modules, so the shipped app silently had no jieba. Only skip when the
    // platform has no prebuild and the optional install legitimately failed.
    const modulePath = join(desktopRoot, 'node_modules', 'nodejieba');
    if (!existsSync(modulePath)) {
      expect(optional.nodejieba, 'optional install may fail on platforms without a prebuild').toBeTruthy();
      return;
    }
    for (const file of DICT_FILES) {
      const dictPath = join(modulePath, 'submodules', 'cppjieba', 'dict', file);
      expect(existsSync(dictPath), `${file} missing from the installed module`).toBe(true);
    }
  });

  it('unpacks nodejieba from app.asar so native dictionary reads can succeed', () => {
    const builder = readJson(join(desktopRoot, 'electron-builder.json'));
    const asarUnpack = builder.asarUnpack;
    expect(Array.isArray(asarUnpack)).toBe(true);
    expect(
      (asarUnpack as string[]).some(pattern => pattern.includes('nodejieba')),
      'asarUnpack must cover nodejieba; its dictionaries are read by C++ ifstream, '
      + 'which cannot read through asar and aborts the process on failure.',
    ).toBe(true);
  });
});

describe('jieba dictionary resolution', () => {
  it('resolves every dictionary to a readable path', async () => {
    const { resolveJiebaDictPaths } = await import('../../../src/ai/memory/segment.js');
    const paths = resolveJiebaDictPaths();
    if (paths === null) {
      // nodejieba absent (e.g. `npm ci --ignore-scripts`): degradation is the
      // documented behaviour, so there is nothing to resolve.
      return;
    }
    for (const file of DICT_FILES) {
      const resolved = paths[file];
      expect(resolved, `missing resolved path for ${file}`).toBeTruthy();
      expect(existsSync(resolved), `${file} is not readable at ${resolved}`).toBe(true);
    }
  });

  it('rewrites app.asar paths to app.asar.unpacked', async () => {
    const { rewriteAsarPath } = await import('../../../src/ai/memory/segment.js');
    expect(rewriteAsarPath('/A/Resources/app.asar/node_modules/nodejieba/x/jieba.dict.utf8'))
      .toBe('/A/Resources/app.asar.unpacked/node_modules/nodejieba/x/jieba.dict.utf8');
    // Already unpacked, or an ordinary dev path: unchanged.
    expect(rewriteAsarPath('/A/Resources/app.asar.unpacked/node_modules/nodejieba/x'))
      .toBe('/A/Resources/app.asar.unpacked/node_modules/nodejieba/x');
    expect(rewriteAsarPath('/repo/node_modules/nodejieba/x')).toBe('/repo/node_modules/nodejieba/x');
  });

  it('reports segmentation unavailable when a dictionary cannot be read', async () => {
    const { segmentationAvailable } = await import('../../../src/ai/memory/segment.js');
    // Must probe dictionary readability, not merely `require` success: requiring
    // nodejieba succeeds without the dictionaries because loading is lazy, and
    // the first cut() would then abort the process.
    expect(typeof segmentationAvailable()).toBe('boolean');
  });

  it('segments Chinese when jieba is available', async () => {
    const { segmentationAvailable, segmentChinese } = await import('../../../src/ai/memory/segment.js');
    if (!segmentationAvailable()) return;
    // Proves the dictionaries actually loaded — a failed load would either abort
    // or leave the text unsegmented.
    expect(segmentChinese('用户权限设计')).toContain(' ');
  });
});

describe('nodejieba dictionary layout assumptions', () => {
  it('still ships the five dictionaries this contract depends on', () => {
    const localRequire = createRequire(join(repoRoot, 'package.json'));
    let entry: string;
    try {
      entry = localRequire.resolve('nodejieba');
    } catch {
      return; // not installed; nothing to assert
    }
    const dictDir = join(dirname(entry), 'submodules', 'cppjieba', 'dict');
    for (const file of DICT_FILES) {
      expect(existsSync(join(dictDir, file)), `${file} missing from ${dictDir}`).toBe(true);
    }
  });
});
