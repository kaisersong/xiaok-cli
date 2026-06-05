#!/usr/bin/env node
/**
 * Synchronizes desktop/shared/ → dist/contract/desktop-shared/
 *
 * Usage:
 *   node desktop/scripts/sync-shared-vendor.mjs [--allow-dirty] [--verify]
 *
 * Modes:
 *   (default)      Copy, compute hashes, stage to git. Fails if source is dirty.
 *   --allow-dirty  Copy and write .build-meta.json but do NOT stage. Exit 2.
 *   --verify       Check that dist hashes match source. Exit 1 on mismatch.
 */
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const ROOT = resolve(import.meta.dirname, '..', '..');
const SOURCE_DIR = join(ROOT, 'desktop', 'shared');
const DIST_DIR = join(ROOT, 'dist', 'contract', 'desktop-shared');
const META_PATH = join(DIST_DIR, '.build-meta.json');

const args = process.argv.slice(2);
const allowDirty = args.includes('--allow-dirty');
const verifyOnly = args.includes('--verify');

function hashFile(filePath) {
  const content = readFileSync(filePath);
  return createHash('sha256').update(content).digest('hex');
}

function getSourceManifest() {
  const files = readdirSync(SOURCE_DIR).filter(f => f.endsWith('.ts')).sort();
  const entries = {};
  for (const file of files) {
    entries[file] = hashFile(join(SOURCE_DIR, file));
  }
  return entries;
}

function getDistManifest() {
  if (!existsSync(DIST_DIR)) return null;
  const files = readdirSync(DIST_DIR).filter(f => f.endsWith('.ts')).sort();
  const entries = {};
  for (const file of files) {
    entries[file] = hashFile(join(DIST_DIR, file));
  }
  return entries;
}

async function isSourceDirty() {
  try {
    const { stdout } = await execFileAsync('git', ['status', '--porcelain', '--', 'desktop/shared/'], { cwd: ROOT });
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

async function stageDistDir() {
  await execFileAsync('git', ['add', '--', 'dist/contract/desktop-shared/'], { cwd: ROOT });
}

function copySourceToDist() {
  mkdirSync(DIST_DIR, { recursive: true });
  const files = readdirSync(SOURCE_DIR).filter(f => f.endsWith('.ts'));
  for (const file of files) {
    cpSync(join(SOURCE_DIR, file), join(DIST_DIR, file));
  }
}

function writeBuildMeta(manifest, dirty) {
  const meta = {
    generatedAt: new Date().toISOString(),
    dirty,
    files: manifest,
  };
  writeFileSync(META_PATH, JSON.stringify(meta, null, 2) + '\n');
}

// --- verify mode ---
if (verifyOnly) {
  const source = getSourceManifest();
  const dist = getDistManifest();
  if (!dist) {
    console.error('[error] dist/contract/desktop-shared/ does not exist. Run sync first.');
    process.exit(1);
  }
  const sourceKeys = Object.keys(source);
  const distKeys = Object.keys(dist);
  const mismatch = sourceKeys.filter(k => source[k] !== dist[k]);
  const missing = sourceKeys.filter(k => !dist[k]);
  const extra = distKeys.filter(k => !source[k]);
  if (mismatch.length === 0 && missing.length === 0 && extra.length === 0) {
    console.log('[ok] dist/contract/desktop-shared/ is in sync with desktop/shared/.');
    process.exit(0);
  }
  if (missing.length) console.error('[mismatch] missing in dist:', missing.join(', '));
  if (extra.length) console.error('[mismatch] extra in dist:', extra.join(', '));
  if (mismatch.length) console.error('[mismatch] hash differs:', mismatch.join(', '));
  process.exit(1);
}

// --- sync mode ---
async function main() {
  const dirty = await isSourceDirty();

  if (dirty && !allowDirty) {
    console.error('[error] desktop/shared/ has uncommitted changes. Use --allow-dirty to force write without staging.');
    process.exit(1);
  }

  copySourceToDist();
  const manifest = getSourceManifest();
  writeBuildMeta(manifest, dirty);

  if (dirty) {
    console.log('[hint] vendor written to disk but NOT staged due to dirty source');
    process.exit(2);
  }

  await stageDistDir();
  console.log('[ok] dist/contract/desktop-shared/ synced and staged.');
  process.exit(0);
}

main().catch(err => {
  console.error('[fatal]', err.message);
  process.exit(1);
});
