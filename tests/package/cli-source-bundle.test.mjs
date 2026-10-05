import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bundleNativeSource } from '../../scripts/pack-cli.mjs';

test('source bundling rejects a native binary in the dependency closure', async () => {
  const root = await mkdtemp(join(tmpdir(), 'xiaok-source-bundle-test-'));
  try {
    const pkg = join(root, 'node_modules', '@mapbox', 'node-pre-gyp');
    await mkdir(pkg, { recursive: true });
    await writeFile(join(pkg, 'package.json'), JSON.stringify({ name: '@mapbox/node-pre-gyp', version: '2.0.3' }));
    await writeFile(join(pkg, 'foreign.node'), 'foreign platform binary');
    await assert.rejects(bundleNativeSource({ root, stage: join(root, 'stage'), npmCli: '' }), /native binary/);
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 3 });
  }
});

test('source bundling rejects an unexpected installer version', async () => {
  const root = await mkdtemp(join(tmpdir(), 'xiaok-source-bundle-test-'));
  try {
    const pkg = join(root, 'node_modules', '@mapbox', 'node-pre-gyp');
    await mkdir(pkg, { recursive: true });
    await writeFile(join(pkg, 'package.json'), JSON.stringify({ name: '@mapbox/node-pre-gyp', version: '1.0.11' }));
    await assert.rejects(bundleNativeSource({ root, stage: join(root, 'stage'), npmCli: '' }), /expected.*2\.0\.3/);
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 3 });
  }
});
