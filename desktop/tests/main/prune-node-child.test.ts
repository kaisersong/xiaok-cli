// @vitest-environment node
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { pruneNodeChildDependencies } = require('../../scripts/prune-node-child.cjs');
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 5 });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'xiaok-child-package-'));
  roots.push(root);
  const app = join(root, 'node-child', 'app');

  function write(relative: string, contents = '') {
    const file = join(app, relative);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, contents);
  }

  function pkg(location: string, manifest = {}) {
    write(join(location, 'package.json'), JSON.stringify(manifest));
    write(join(location, 'index.js'), 'module.exports = {};');
  }

  return { app, write, pkg, exists: (relative: string) => existsSync(join(app, relative)) };
}

it('retains dependencies of child entries, indirect workers, and nested npm packages', () => {
  const { app, write, pkg, exists } = fixture();
  write('dist/main/entry.js', `
    export { open } from './reader.js';
    new Worker(new URL('./worker.mjs', import.meta.url));
  `);
  write('dist/main/reader.js', "export const open = () => import('@fixture/native/reader');");
  write('dist/main/worker.mjs', "const sourceRequire = createRequire(import.meta.url); sourceRequire.resolve('worker-dep/package.json');");
  write('dist/main/main-only.js', "import 'main-only';");
  pkg('node_modules/@fixture/native', {
    dependencies: { leaf: '2' },
    optionalDependencies: { binding: '*', 'not-for-this-target': '*' },
    peerDependencies: { 'peer-dep': '*' },
  });
  pkg('node_modules/@fixture/native/node_modules/leaf');
  pkg('node_modules/leaf');
  pkg('node_modules/binding');
  pkg('node_modules/peer-dep');
  pkg('node_modules/worker-dep');
  pkg('node_modules/main-only');
  write('node_modules/@fixture/native/reader.js');
  write('node_modules/@fixture/native/reader.js.map');
  write('node_modules/@fixture/native/runtime.map');
  write('dist/main/entry.js.map');

  pruneNodeChildDependencies(app, ['dist/main/entry.js']);

  expect(exists('node_modules/@fixture/native/reader.js')).toBe(true);
  expect(exists('node_modules/@fixture/native/node_modules/leaf/index.js')).toBe(true);
  expect(exists('node_modules/binding/index.js')).toBe(true);
  expect(exists('node_modules/peer-dep/index.js')).toBe(true);
  expect(exists('node_modules/worker-dep/index.js')).toBe(true);
  expect(exists('node_modules/@fixture/native/runtime.map')).toBe(true);
  expect(exists('dist/main/entry.js.map')).toBe(true);
  expect(exists('node_modules/@fixture/native/reader.js.map')).toBe(false);
  expect(exists('node_modules/leaf')).toBe(false);
  expect(exists('node_modules/main-only')).toBe(false);
});

it('preserves a package invoked as a child argument without an app import', () => {
  const { app, write, pkg, exists } = fixture();
  pkg('node_modules/cli', { dependencies: { helper: '*' } });
  pkg('node_modules/helper');
  write('node_modules/cli/scripts/install.js');
  write('node_modules/cli/bin/cli.exe');

  pruneNodeChildDependencies(app, ['node_modules/cli/scripts/install.js']);

  expect(exists('node_modules/cli/bin/cli.exe')).toBe(true);
  expect(exists('node_modules/helper/package.json')).toBe(true);
});

it('fails before pruning when an expected child entry is absent', () => {
  const { app, pkg, exists } = fixture();
  pkg('node_modules/keep');
  expect(() => pruneNodeChildDependencies(app, ['dist/main/missing.js'])).toThrow(/missing\.js/);
  expect(exists('node_modules/keep/index.js')).toBe(true);
});
