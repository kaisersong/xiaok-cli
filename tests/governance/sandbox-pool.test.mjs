import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(join(root, 'package.json'));

async function loadTestPool(rel) {
  const { loadConfigFromFile } = await import(pathToFileURL(require.resolve('vite')).href);
  const configFile = join(root, rel);
  const loaded = await loadConfigFromFile({ command: 'serve', mode: 'test' }, configFile, root);
  assert.ok(loaded, `could not load ${rel}`);
  const value = typeof loaded.config === 'function' ? await loaded.config({ command: 'serve', mode: 'test' }) : loaded.config;
  return value?.test?.pool;
}

test('sandbox / skill-release / yolo keep pool forks (#123; governance always-on)', async () => {
  assert.equal(await loadTestPool('vitest.sandbox.config.mjs'), 'forks');
  assert.equal(await loadTestPool('vitest.skill-release.config.mjs'), 'forks');
  assert.equal(await loadTestPool('vitest.yolo.config.mjs'), 'forks');
});

test('REGISTERED sandbox flags stay true for the three pool-guarded configs (#123)', async () => {
  const { REGISTERED } = await import(pathToFileURL(join(root, 'scripts/check-test-env-isolation.mjs')).href);
  const byConfig = Object.fromEntries(REGISTERED.map(e => [e.config, e]));
  for (const name of ['vitest.sandbox.config.mjs', 'vitest.skill-release.config.mjs', 'vitest.yolo.config.mjs']) {
    assert.equal(byConfig[name]?.sandbox, true, `${name} must keep sandbox:true so static forks gate cannot be short-circuited`);
  }
});

test('sandbox npm scripts do not override pool on the command line (#123)', async () => {
  const { readFileSync } = await import('node:fs');
  const scripts = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).scripts;
  for (const [name, cmd] of Object.entries(scripts)) {
    if (/vitest\.(sandbox|skill-release|yolo)\.config\.mjs|test:sandbox:run|test:skill:release:run/.test(cmd)) {
      assert.ok(!/--pool(=|\s)/.test(cmd), `${name} must not pass --pool (would bypass forks gate)`);
    }
  }
});
