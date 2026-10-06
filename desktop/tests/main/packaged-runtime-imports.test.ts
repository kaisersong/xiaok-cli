import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { finished } from 'node:stream/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createPackageWithOptions } from '@electron/asar';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const electronPath = require('electron') as string;
let root: string;
let input: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'xiaok-runtime-imports-'));
  input = join(root, 'input');
  mkdirSync(input);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function write(relative: string, contents: string) {
  const file = join(input, relative);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, contents);
}
async function fixture(code: string, dependencies = {}, extra = {}, unpack = false) {
  write('package.json', JSON.stringify({ type: 'module', dependencies, ...extra }));
  write('dist/main/main.js', code);
  const asarPath = join(root, 'app.asar');
  // ASAR resolves with an ending Writable; wait for its payload to flush.
  const output = await createPackageWithOptions(input, asarPath, unpack ? { unpackDir: 'node_modules' } : {});
  await finished(output, { cleanup: true });
  return { asarPath, electronPath };
}
function verify(options: object) {
  return require('../../scripts/verify-packaged-runtime-dependencies.cjs').verifyPackagedRuntimeDependencies(options);
}

describe('actual packaged runtime imports', () => {
  it.each(['missing', 'dev-only', 'optional-only'])('rejects %s static Ajv declaration before fallback to development dependencies', async kind => {
    const extra = kind === 'dev-only' ? { devDependencies: { ajv: '8.20.0' } }
      : kind === 'optional-only' ? { optionalDependencies: { ajv: '8.20.0' } } : {};
    const options = await fixture("import 'ajv/dist/2020.js';", {}, extra);
    expect(() => verify(options)).toThrow(/ajv.*production dependency/);
  });

  it('rejects a missing local production module before Desktop launch', async () => {
    const options = await fixture("import './memory/configuration.js';");
    expect(() => verify(options)).toThrow(/missing packaged local module.*configuration/);
  });

  it('resolves relative re-exports inside the archive', async () => {
    write('dist/main/memory/configuration.js', 'export const ready = true;');
    const options = await fixture("export { ready } from './memory/configuration.js';");
    expect(verify(options).specifiers).toEqual([]);
  });

  it('rejects a declared package missing from the ASAR', async () => {
    const options = await fixture("import 'cross-spawn';", { 'cross-spawn': '7.0.6' });
    expect(() => verify(options)).toThrow(/cross-spawn/);
  });

  it('rejects a successful resolution that falls back to dependencies outside the packaged archive', async () => {
    const parentPackage = join(root, 'node_modules', 'ajv');
    mkdirSync(parentPackage, { recursive: true });
    writeFileSync(join(parentPackage, 'package.json'), JSON.stringify({ name: 'ajv', main: 'index.js' }));
    writeFileSync(join(parentPackage, 'index.js'), 'module.exports = {};');
    const options = await fixture("import 'ajv';", { ajv: '8.20.0' });
    expect(() => verify(options)).toThrow(/outside packaged node_modules/);
  });

  it('rejects a package containing only a manifest and no import entry', async () => {
    write('node_modules/ajv/package.json', JSON.stringify({ name: 'ajv', main: 'missing.js' }));
    const options = await fixture("import 'ajv';", { ajv: '8.20.0' });
    expect(() => verify(options)).toThrow(/ajv/);
  });

  it('rejects a missing imported subpath even when the package entry exists', async () => {
    write('node_modules/ajv/package.json', JSON.stringify({ name: 'ajv', main: 'index.js' }));
    write('node_modules/ajv/index.js', 'module.exports = {};');
    const options = await fixture("import 'ajv/dist/2020.js';", { ajv: '8.20.0' });
    expect(() => verify(options)).toThrow(/ajv\/dist\/2020.js/);
  });

  it.each([false, true])('imports scoped package subpaths, re-exports and all chunks with unpacked=%s', async unpack => {
    write('node_modules/@fixture/provider/package.json', JSON.stringify({ name: '@fixture/provider', type: 'module', exports: { '.': { import: './index.js' }, './child': { import: './child.js' } } }));
    write('node_modules/@fixture/provider/index.js', 'export const value = 1;');
    write('node_modules/@fixture/provider/child.js', 'export const value = 2;');
    write('dist/main/nested/chunk.js', "export { value } from '@fixture/provider/child';");
    const options = await fixture("import '@fixture/provider';", { '@fixture/provider': '1.0.0' }, {}, unpack);
    expect(verify(options).specifiers).toEqual(['@fixture/provider', '@fixture/provider/child']);
  });

  it('scans secondary chunks even when the main entry imports no external packages', async () => {
    write('dist/main/nested/chunk.mjs', "export * from 'ajv';");
    const options = await fixture('export const ready = true;');
    expect(() => verify(options)).toThrow(/ajv.*production dependency/);
  });

  it('reads actual ASAR chunks with Windows archive path semantics', async () => {
    write('dist/main/nested/chunk.js', "import 'node:fs';");
    const options = await fixture("import 'node:path';");
    if (process.platform === 'win32') {
      expect(verify(options).specifiers).toEqual([]);
      return;
    }
    const paths = require('node:path');
    const separator = Object.getOwnPropertyDescriptor(paths, 'sep')!;
    const mocks = ['join', 'dirname', 'basename', 'normalize'].map(name => vi.spyOn(paths, name).mockImplementation(paths.win32[name]));
    Object.defineProperty(paths, 'sep', { ...separator, value: paths.win32.sep });
    try {
      expect(verify(options).specifiers).toEqual([]);
    } finally {
      for (const mock of mocks) mock.mockRestore();
      Object.defineProperty(paths, 'sep', separator);
    }
  });

  it.each(['node:sqlite', 'node:test', 'node:test/reporters', 'node:sea'])('recognizes prefix-only builtin %s on the CI Node version', async specifier => {
    const options = await fixture(`import '${specifier}';`);
    expect(verify(options).specifiers).toEqual([]);
  });

  it.each(['sqlite', 'node:xiaok-not-a-builtin'])('does not exempt non-builtin %s', async specifier => {
    const options = await fixture(`import '${specifier}';`);
    expect(() => verify(options)).toThrow(/production dependency/);
  });

  it('checks local static imports while excluding builtins, comments, strings and optional dynamic imports', async () => {
    write('dist/main/local.js', 'export const ready = true;');
    const options = await fixture(`import 'electron'; import 'fs'; import 'node:fs/promises'; import './local.js';
      // import 'missing-comment';
      const example = "import 'missing-string'";
      try { await import('optional-model'); } catch {}
    `);
    expect(verify(options).specifiers).toEqual([]);
  });

  it.each(['darwin', 'win32'])('resolves the actual %s packaging resources path', platform => {
    const verifier = require('../../scripts/verify-packaged-runtime-dependencies.cjs');
    const result = verifier.packagedRuntimePaths({ electronPlatformName: platform, appOutDir: root,
      packager: { appInfo: { productFilename: 'xiaok' } } });
    expect(result.asarPath).toBe(platform === 'darwin'
      ? join(root, 'xiaok.app', 'Contents', 'Resources', 'app.asar') : join(root, 'resources', 'app.asar'));
    expect(result.electronPath).toBe(platform === 'darwin'
      ? join(root, 'xiaok.app', 'Contents', 'MacOS', 'xiaok') : join(root, 'xiaok.exe'));
  });
});
