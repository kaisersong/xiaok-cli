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


// Run exact production entry scripts in private package fixtures. Header-only
// PE fixtures exercise packaging validation and provide no execution authority.
import { copyFile, readFile, readdir, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const packageRoot = process.cwd();
const hashBytes = bytes => createHash('sha256').update(bytes).digest('hex');
async function inventory(root) {
  const rows = [];
  async function visit(directory, relative = '') {
    for (const name of (await readdir(directory)).sort()) {
      const path = join(directory, name), key = relative ? `${relative}/${name}` : name;
      const info = await lstat(path);
      assert(!info.isSymbolicLink());
      if (info.isDirectory()) {
        rows.push({ path: key, mode: info.mode, kind: 'directory' });
        await visit(path, key);
      } else rows.push({ path: key, mode: info.mode, kind: 'file', sha256: hashBytes(await readFile(path)) });
    }
  }
  await visit(root);
  return rows;
}
async function withEntryFixture(architectures, run) {
  const parent = join(packageRoot, '.test-cache');
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, 'main-pack-entry-'));
  try {
    await writeFile(join(root, 'package.json'), '{"type":"module"}\n');
    await mkdir(join(root, 'scripts', 'verification'), { recursive: true });
    for (const name of ['pack-cli.mjs', 'verification/copy-windows-absence.mjs']) {
      const source = join(packageRoot, 'scripts', name), target = join(root, 'scripts', name);
      await copyFile(source, target);
      assert.equal(hashBytes(await readFile(target)), hashBytes(await readFile(source)));
    }
    const sourceDir = join(root, 'src', 'runtime', 'verification', 'native');
    await mkdir(sourceDir, { recursive: true });
    const source = Buffer.from('actual entry source fixture'), core = Buffer.from('actual entry core fixture');
    await writeFile(join(sourceDir, 'windows-installation-absence.c'), source);
    await writeFile(join(sourceDir, 'windows-installation-absence-core.h'), core);
    const reader = join(root, 'dist', 'runtime', 'verification');
    await mkdir(reader, { recursive: true });
    await writeFile(join(reader, 'windows-installation-absence.js'), '// reader packaging fixture\n');
    for (const arch of architectures) {
      const directory = join(root, 'data', 'verification', 'windows', `win32-${arch}`);
      await mkdir(directory, { recursive: true });
      const bytes = Buffer.alloc(256);
      bytes.write('MZ'); bytes.writeUInt32LE(128, 60); bytes.write('PE\0\0', 128);
      bytes.writeUInt16LE(arch === 'x64' ? 0x8664 : 0xaa64, 132);
      await writeFile(join(directory, 'windows-installation-absence.exe'), bytes);
      await writeFile(join(directory, 'windows-installation-absence.json'), JSON.stringify({
        version: 1, target: `win32-${arch}`, sourceSha256: hashBytes(source), coreSha256: hashBytes(core), sha256: hashBytes(bytes),
      }));
    }
    const before = await inventory(root);
    await run(root);
    assert.deepEqual(await inventory(root), before, 'failed entry must preserve every input byte/mode and create no output');
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 3 });
  }
}
test('actual prepack entry refuses direct source-tree packing without outputs or input changes', async () => {
  await withEntryFixture([], async root => {
    const result = spawnSync(process.execPath, [join(root, 'scripts', 'pack-cli.mjs'), '--prepack-check'], { cwd: root, encoding: 'utf8', timeout: 30_000 });
    assert.ifError(result.error);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr.trim(), 'Use npm run pack:cli -- --output <directory>, then publish its .tgz. Source overrides cannot fix consumer installations.');
  });
});
for (const present of [[], ['x64'], ['arm64']]) {
  test(`actual pack entry refuses missing universal native input (${present.join(',') || 'none'}) before packing`, async () => {
    await withEntryFixture(present, async root => {
      const result = spawnSync(process.execPath, [join(root, 'scripts', 'pack-cli.mjs'), '--output', join(root, 'output')], { cwd: root, encoding: 'utf8', timeout: 30_000 });
      assert.ifError(result.error);
      assert.equal(result.status, 1);
      assert.equal(result.stdout, '');
      const missing = present.includes('x64') ? 'arm64' : 'x64';
      assert(result.stderr.includes(`Windows absence artifact missing: ${join(root, 'data', 'verification', 'windows', `win32-${missing}`)}`), result.stderr);
    });
  });
}
test('merged manifest preserves native source lifecycle and all original helper build gates', async () => {
  const manifest = JSON.parse(await readFile(process.env.XIAOK_TEST_CLI_MANIFEST || join(packageRoot, 'package.json'), 'utf8'));
  const lock = JSON.parse(await readFile(join(packageRoot, 'package-lock.json'), 'utf8'));
  const desktopManifest = JSON.parse(await readFile(join(packageRoot, 'desktop', 'package.json'), 'utf8'));
  assert.equal(manifest.version, desktopManifest.version);
  assert.equal(manifest.scripts.postinstall, 'node scripts/prepare-cli-native.mjs');
  assert.equal(manifest.scripts.prepack, 'node scripts/pack-cli.mjs --prepack-check');
  assert.equal(manifest.scripts['pack:cli'], 'node scripts/pack-cli.mjs');
  for (const name of ['build', 'build:rollback']) assert(manifest.scripts[name].endsWith(' && node scripts/verification/copy-windows-absence.mjs cli'), name);
  assert(manifest.scripts['build:release'].endsWith(' && node scripts/verification/copy-windows-absence.mjs cli --require-all'));
  for (const name of ['scripts/prepare-cli-pty.mjs', 'scripts/prepare-cli-native.mjs']) assert(manifest.files.includes(name), name);
  assert.equal(manifest.devDependencies['adm-zip'], '0.5.17');
  assert.equal(manifest.devDependencies.tar, '7.5.22');
  assert.equal(lock.version, manifest.version);
  assert.equal(lock.packages[''].version, manifest.version);
  for (const section of ['dependencies', 'optionalDependencies', 'devDependencies']) assert.deepEqual(manifest[section], lock.packages[''][section], section);
});
test('original lock devDependencies contains exactly one pinned tar key', async () => {
  const text = await readFile(join(packageRoot, 'package-lock.json'), 'utf8');
  const beforeModules = text.slice(0, text.indexOf('"node_modules/'));
  assert.equal([...beforeModules.matchAll(/"tar"\s*:/g)].length, 1);
  assert.equal(JSON.parse(text).packages[''].devDependencies.tar, '7.5.22');
});
