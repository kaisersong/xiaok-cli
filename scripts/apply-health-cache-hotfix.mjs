import { createHash, randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const installation = process.argv[2];
if (!installation || installation.startsWith('--')) throw new Error('Usage: node apply-health-cache-hotfix.mjs <xiaokcode install directory> [--dry-run]');
const root = resolve(installation);
let patchRoot = dirname(fileURLToPath(import.meta.url));
if (!existsSync(join(patchRoot, 'manifest.json'))) patchRoot = join(patchRoot, '..', 'data', 'hotfixes', 'windows-health-cache-1.5.7');
let dryRun = false;
for (let index = 3; index < process.argv.length; index++) {
  if (process.argv[index] === '--dry-run') dryRun = true;
  else if (process.argv[index] === '--patch-dir' && process.argv[index + 1]) patchRoot = resolve(process.argv[++index]);
  else throw new Error(`Unsupported argument: ${process.argv[index]}`);
}
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
if (pkg.name !== 'xiaokcode' || pkg.version !== '1.5.7') throw new Error('This patch supports xiaokcode 1.5.7 only');
const manifest = JSON.parse(readFileSync(join(patchRoot, 'manifest.json'), 'utf8'));
const allowed = ['dist/platform/runtime/health-store.js', 'dist/platform/runtime/health-store.d.ts'];
if (manifest.schemaVersion !== 1 || manifest.version !== '1.5.7' || !Array.isArray(manifest.files)
  || manifest.files.length !== allowed.length || manifest.files.some((item, index) => item.file !== allowed[index]
    || !/^[0-9a-f]{64}$/.test(item.sha256) || !/^[0-9a-f]{64}$/.test(item.originalSha256))) {
  throw new Error('Unsupported patch manifest');
}
const writes = manifest.files.map(item => {
  const bytes = readFileSync(join(patchRoot, 'payload', item.file));
  if (sha(bytes) !== item.sha256) throw new Error(`Payload verification failed: ${item.file}`);
  const target = join(root, item.file);
  const original = readFileSync(target);
  const currentSha = sha(original);
  if (currentSha !== item.originalSha256 && currentSha !== item.sha256) throw new Error(`Unsupported installed file: ${item.file}`);
  if (item.file.endsWith('.js')) {
    const result = spawnSync(process.execPath, ['--check', join(patchRoot, 'payload', item.file)], { encoding: 'utf8' });
    if (result.error || result.status !== 0) throw new Error(`Syntax verification failed: ${item.file}`);
  }
  return { ...item, target, bytes, original, currentSha };
});
if (!existsSync(join(root, 'dist', 'utils', 'atomic-file.js'))) throw new Error('Installed atomic-file helper is missing');
if (dryRun || writes.every(item => item.currentSha === item.sha256)) {
  console.log(JSON.stringify({ version: pkg.version, files: writes.length, dryRun, alreadyApplied: writes.every(item => item.currentSha === item.sha256) }));
  process.exit(0);
}
const backup = join(root, `.health-cache-backup-${Date.now()}-${randomUUID()}`);
mkdirSync(backup);
for (const item of writes) {
  const saved = join(backup, item.file); mkdirSync(dirname(saved), { recursive: true }); copyFileSync(item.target, saved);
}
function replace(target, bytes) {
  const temporary = `${target}.${process.pid}.${randomUUID()}.health-hotfix.tmp`;
  try { writeFileSync(temporary, bytes, { flag: 'wx' }); renameSync(temporary, target); }
  finally { rmSync(temporary, { force: true }); }
}
const completed = [];
try {
  for (const item of writes) {
    if (sha(readFileSync(item.target)) !== item.currentSha) throw new Error(`Installation changed during patch: ${item.file}`);
    if (item.currentSha === item.sha256) continue;
    replace(item.target, item.bytes); completed.push(item);
    if (sha(readFileSync(item.target)) !== item.sha256) throw new Error(`Installation verification failed: ${item.file}`);
  }
} catch (error) {
  const failures = [];
  for (const item of completed.reverse()) {
    try { replace(item.target, item.original); } catch { failures.push(item.file); }
  }
  throw new Error(`Hotfix installation failed; originals retained at ${backup}${failures.length ? `; rollback failed for ${failures.join(', ')}` : '; changed files restored'}`, { cause: error });
}
console.log(JSON.stringify({ version: pkg.version, files: completed.length, backup, alreadyApplied: false }));
