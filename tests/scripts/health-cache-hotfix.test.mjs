import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const patchRoot = process.env.XIAOK_HEALTH_HOTFIX_TEST_DIR ?? join(process.cwd(), 'data', 'hotfixes', 'windows-health-cache-1.5.7');
const installer = process.env.XIAOK_HEALTH_HOTFIX_TEST_DIR ? join(patchRoot, 'apply-health-cache-hotfix.mjs') : join(process.cwd(), 'scripts', 'apply-health-cache-hotfix.mjs');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function fixture(version = '1.5.7') {
  const root = mkdtempSync(join(tmpdir(), 'xiaok-health-hotfix-'));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'xiaokcode', version }));
  const manifest = JSON.parse(readFileSync(join(patchRoot, 'manifest.json'), 'utf8'));
  for (const item of manifest.files) {
    const target = join(root, item.file); mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, readFileSync(join(patchRoot, 'original', item.file)));
  }
  mkdirSync(join(root, 'dist', 'utils'), { recursive: true });
  writeFileSync(join(root, 'dist', 'utils', 'atomic-file.js'), readFileSync(join(process.cwd(), 'dist', 'utils', 'atomic-file.js')));
  return { root, manifest };
}
function run(root, ...args) {
  return spawnSync(process.execPath, [installer, root, '--patch-dir', patchRoot, ...args], { encoding: 'utf8' });
}
test('dry run verifies the real npm 1.5.7 originals without changing the installation', () => {
  const { root, manifest } = fixture();
  try {
    const result = run(root, '--dry-run'); assert.equal(result.status, 0, result.stderr);
    for (const item of manifest.files) assert.equal(hash(readFileSync(join(root, item.file))), item.originalSha256);
    assert.equal(readdirSync(root).some(name => name.startsWith('.health-cache-backup-')), false);
  } finally { rmSync(root, { recursive: true, force: true, maxRetries: 3 }); }
});
test('installs verified payloads, preserves originals and is idempotent', () => {
  const { root, manifest } = fixture();
  try {
    const result = run(root); assert.equal(result.status, 0, result.stderr);
    const info = JSON.parse(result.stdout);
    for (const item of manifest.files) {
      assert.equal(hash(readFileSync(join(root, item.file))), item.sha256);
      assert.equal(hash(readFileSync(join(info.backup, item.file))), item.originalSha256);
    }
    const repeat = run(root); assert.equal(repeat.status, 0, repeat.stderr);
    assert.equal(JSON.parse(repeat.stdout).alreadyApplied, true);
    assert.equal(readdirSync(root).filter(name => name.startsWith('.health-cache-backup-')).length, 1);
  } finally { rmSync(root, { recursive: true, force: true, maxRetries: 3 }); }
});
test('refuses other versions without writing', () => {
  const { root } = fixture('1.5.6');
  try { const result = run(root); assert.notEqual(result.status, 0); assert.match(result.stderr, /1\.5\.7/); }
  finally { rmSync(root, { recursive: true, force: true, maxRetries: 3 }); }
});
test('rejects a modified destination before installing either file', () => {
  const { root, manifest } = fixture();
  try {
    writeFileSync(join(root, manifest.files[1].file), 'other task change');
    const result = run(root); assert.notEqual(result.status, 0); assert.match(result.stderr, /Unsupported installed file/);
    assert.equal(hash(readFileSync(join(root, manifest.files[0].file))), manifest.files[0].originalSha256);
    assert.equal(readdirSync(root).some(name => name.startsWith('.health-cache-backup-')), false);
  } finally { rmSync(root, { recursive: true, force: true, maxRetries: 3 }); }
});
test('rejects a corrupt payload before touching the installation', () => {
  const { root, manifest } = fixture();
  const bad = mkdtempSync(join(tmpdir(), 'xiaok-health-bad-patch-'));
  try {
    writeFileSync(join(bad, 'manifest.json'), JSON.stringify(manifest));
    for (const item of manifest.files) {
      const target = join(bad, 'payload', item.file); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, 'corrupt');
    }
    const result = run(root, '--patch-dir', bad); assert.notEqual(result.status, 0); assert.match(result.stderr, /Payload verification failed/);
    assert.equal(hash(readFileSync(join(root, manifest.files[0].file))), manifest.files[0].originalSha256);
    assert.equal(existsSync(join(root, '.health-cache-backup')), false);
  } finally { rmSync(root, { recursive: true, force: true, maxRetries: 3 }); rmSync(bad, { recursive: true, force: true, maxRetries: 3 }); }
});
test('the installed production module starts with an unwritable cache directory', () => {
  const { root } = fixture();
  try {
    const result = run(root); assert.equal(result.status, 0, result.stderr);
    const blocker = join(root, 'cache-blocker'); writeFileSync(blocker, 'existing user file');
    const script = `const {FileCapabilityHealthStore}=await import(process.argv[1]);const store=new FileCapabilityHealthStore(process.argv[2]);const saved=store.set('repo',{updatedAt:1,summary:'live',capabilities:[]});if(saved!==false||store.get('repo')?.summary!=='live')throw Error('installed cache isolation failed');`;
    const smoke = spawnSync(process.execPath, ['--input-type=module', '-e', script, pathToFileURL(join(root, 'dist', 'platform', 'runtime', 'health-store.js')).href, join(blocker, 'health.json')], { encoding: 'utf8' });
    assert.equal(smoke.status, 0, smoke.stderr);
    assert.equal(readFileSync(blocker, 'utf8'), 'existing user file');
  } finally { rmSync(root, { recursive: true, force: true, maxRetries: 3 }); }
});
test('rolls back the first replacement when Windows refuses the second read-only file', { skip: process.platform !== 'win32' }, () => {
  const { root, manifest } = fixture();
  const locked = join(root, manifest.files[1].file); chmodSync(locked, 0o444);
  try {
    const result = run(root); assert.notEqual(result.status, 0); assert.match(result.stderr, /changed files restored/);
    for (const item of manifest.files) assert.equal(hash(readFileSync(join(root, item.file))), item.originalSha256);
    assert.equal(readdirSync(dirname(locked)).some(name => name.endsWith('.health-hotfix.tmp')), false);
  } finally { chmodSync(locked, 0o666); rmSync(root, { recursive: true, force: true, maxRetries: 3 }); }
});
