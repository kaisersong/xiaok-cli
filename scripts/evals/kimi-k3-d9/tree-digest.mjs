import { createHash } from 'node:crypto';
import {
  lstat,
  readFile,
  readdir,
  readlink,
} from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { canonicalize } from './canonical.mjs';
import { D9_ARTIFACT_DIGEST_ALGORITHM } from './constants.mjs';

function compareUtf8(left, right) {
  return Buffer.compare(
    Buffer.from(left.relativePath, 'utf8'),
    Buffer.from(right.relativePath, 'utf8'),
  );
}

function relativePath(root, path) {
  if (root === path) return '.';
  return relative(root, path).split(sep).join('/');
}

function modeOf(stat) {
  return stat.mode & 0o7777;
}

async function inventoryEntry(root, path, entries) {
  const stat = await lstat(path);
  const entryPath = relativePath(root, path);
  if (stat.isSymbolicLink()) {
    entries.push({
      relativePath: entryPath,
      fileType: 'symlink',
      mode: modeOf(stat),
      target: await readlink(path),
    });
    return;
  }
  if (stat.isDirectory()) {
    entries.push({
      relativePath: entryPath,
      fileType: 'directory',
      mode: modeOf(stat),
    });
    const names = await readdir(path);
    names.sort((left, right) => Buffer.compare(
      Buffer.from(left, 'utf8'),
      Buffer.from(right, 'utf8'),
    ));
    for (const name of names) {
      await inventoryEntry(root, join(path, name), entries);
    }
    return;
  }
  if (stat.isFile()) {
    entries.push({
      relativePath: entryPath,
      fileType: 'file',
      mode: modeOf(stat),
      contentSha256: createHash('sha256')
        .update(await readFile(path))
        .digest('hex'),
    });
    return;
  }
  throw new Error('KIMI_D9_TREE_UNSUPPORTED_FILE_TYPE');
}

export async function inventoryTree(rootPath) {
  const root = resolve(rootPath);
  const entries = [];
  await inventoryEntry(root, root, entries);
  entries.sort(compareUtf8);
  return entries;
}

export async function digestTree(rootPath) {
  const entries = await inventoryTree(rootPath);
  const canonicalBytes = canonicalize(entries);
  return {
    algorithm: D9_ARTIFACT_DIGEST_ALGORITHM,
    entries,
    canonicalBytes,
    digest: createHash('sha256').update(canonicalBytes).digest('hex'),
  };
}
