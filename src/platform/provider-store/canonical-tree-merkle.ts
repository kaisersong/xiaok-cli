/**
 * CanonicalTreeMerkle (design v58 §4.4; R38-02).
 *
 * One production tree hasher shared by source snapshots, the slide Python
 * closure and every runtime generation. Hand-rolled walkers were the reason the
 * design kept discovering holes, so the rules are fixed here:
 *
 *  - traversal is `lstat`/no-follow, entries sorted by normalised POSIX path;
 *  - entries are a tagged union: directory{path,mode}, file{path,mode,size,sha256},
 *    symlink{path,mode,rawTargetBytesSha256,normalizedTarget};
 *  - a symlink hashes its raw `readlink` bytes plus the normalised target, and its
 *    resolved target must stay inside the tree root — so re-pointing an internal
 *    link at another file inside the root still changes the digest;
 *  - sockets/devices/FIFOs are rejected, and so is any `nlink > 1` hardlink,
 *    because their alias semantics are not frozen;
 *  - the root digest covers a schema tag and the entry count, so a truncated or
 *    re-encoded entry list cannot collide with a valid one.
 */

import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync, readlinkSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

export const CANONICAL_TREE_MERKLE_SCHEMA = 'xiaok-canonical-tree-merkle-v1';

export type CanonicalTreeEntry =
  | { kind: 'directory'; path: string; mode: string }
  | { kind: 'file'; path: string; mode: string; size: number; sha256: string }
  | { kind: 'symlink'; path: string; mode: string; rawTargetBytesSha256: string; normalizedTarget: string };

export interface CanonicalTree {
  readonly schema: typeof CANONICAL_TREE_MERKLE_SCHEMA;
  readonly root: string;
  readonly entryCount: number;
  readonly entries: readonly CanonicalTreeEntry[];
}

export class CanonicalTreeRejectedError extends Error {
  readonly code: string;

  constructor(code: string, detail: string) {
    super(`${code}: ${detail}`);
    this.code = code;
    this.name = 'CanonicalTreeRejectedError';
  }
}

function toPosix(path: string): string {
  return path.split(sep).join('/');
}

function modeOf(mode: number): string {
  return (mode & 0o7777).toString(8).padStart(4, '0');
}

export function walkCanonicalTree(rootDir: string): CanonicalTreeEntry[] {
  const root = resolve(rootDir);
  const entries: CanonicalTreeEntry[] = [];

  const visit = (absDir: string): void => {
    for (const name of readdirSync(absDir).sort()) {
      const abs = join(absDir, name);
      const rel = toPosix(relative(root, abs));
      const st = lstatSync(abs);
      const mode = modeOf(st.mode);

      if (st.isDirectory()) {
        entries.push({ kind: 'directory', path: rel, mode });
        visit(abs);
        continue;
      }
      if (st.isSymbolicLink()) {
        const rawTarget = readlinkSync(abs, { encoding: 'buffer' });
        const normalizedTarget = toPosix(readlinkSync(abs));
        const resolved = resolve(dirname(abs), normalizedTarget);
        if (relative(root, resolved).startsWith('..')) {
          throw new CanonicalTreeRejectedError(
            'symlink_escapes_root',
            `${rel} -> ${normalizedTarget}`,
          );
        }
        entries.push({
          kind: 'symlink',
          path: rel,
          mode,
          rawTargetBytesSha256: createHash('sha256').update(rawTarget).digest('hex'),
          normalizedTarget,
        });
        continue;
      }
      if (st.isFile()) {
        if (st.nlink > 1) {
          throw new CanonicalTreeRejectedError('hardlink_rejected', `${rel} has nlink=${st.nlink}`);
        }
        entries.push({
          kind: 'file',
          path: rel,
          mode,
          size: st.size,
          sha256: createHash('sha256').update(readFileSync(abs)).digest('hex'),
        });
        continue;
      }
      throw new CanonicalTreeRejectedError('special_node_rejected', rel);
    }
  };

  visit(root);
  entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return entries;
}

export function canonicalTreeRoot(entries: readonly CanonicalTreeEntry[]): string {
  const hash = createHash('sha256');
  hash.update(`${CANONICAL_TREE_MERKLE_SCHEMA}\n${entries.length}\n`);
  for (const entry of entries) {
    const encoded = entry.kind === 'file'
      ? `file\u0000${entry.path}\u0000${entry.mode}\u0000${entry.size}\u0000${entry.sha256}`
      : entry.kind === 'symlink'
        ? `symlink\u0000${entry.path}\u0000${entry.mode}\u0000${entry.rawTargetBytesSha256}\u0000${entry.normalizedTarget}`
        : `directory\u0000${entry.path}\u0000${entry.mode}`;
    hash.update(`${encoded}\n`);
  }
  return hash.digest('hex');
}

export function hashCanonicalTree(rootDir: string): CanonicalTree {
  const entries = walkCanonicalTree(rootDir);
  return {
    schema: CANONICAL_TREE_MERKLE_SCHEMA,
    root: canonicalTreeRoot(entries),
    entryCount: entries.length,
    entries,
  };
}

/**
 * Triple-hash materialisation check (design R38-01): the input must be identical
 * before and after the copy, and the snapshot must match it. Anything else means
 * the input changed while we copied and the candidate must be discarded.
 */
export function assertStableMaterialisation(input: {
  before: CanonicalTree;
  after: CanonicalTree;
  snapshot: CanonicalTree;
}): void {
  if (input.before.root !== input.after.root) {
    throw new CanonicalTreeRejectedError(
      'input_changed_during_copy',
      `${input.before.root} != ${input.after.root}`,
    );
  }
  if (input.snapshot.root !== input.before.root) {
    throw new CanonicalTreeRejectedError(
      'snapshot_mismatch',
      `${input.snapshot.root} != ${input.before.root}`,
    );
  }
}
