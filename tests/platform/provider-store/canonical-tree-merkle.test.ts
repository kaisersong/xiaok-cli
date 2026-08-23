import { chmodSync, linkSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assertStableMaterialisation,
  CanonicalTreeRejectedError,
  hashCanonicalTree,
  walkCanonicalTree,
} from '../../../src/platform/provider-store/canonical-tree-merkle.js';

/** Design v58 §4.4 / R38-02: one production walker, with frozen rejections. */
describe('CanonicalTreeMerkle', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  function tree(): string {
    const dir = mkdtempSync(join(tmpdir(), 'merkle-'));
    dirs.push(dir);
    return dir;
  }

  it('is deterministic and independent of creation order', () => {
    const a = tree();
    mkdirSync(join(a, 'lib'));
    writeFileSync(join(a, 'lib', 'b.py'), 'b');
    writeFileSync(join(a, 'a.py'), 'a');

    const b = tree();
    writeFileSync(join(b, 'a.py'), 'a');
    mkdirSync(join(b, 'lib'));
    writeFileSync(join(b, 'lib', 'b.py'), 'b');

    expect(hashCanonicalTree(a).root).toBe(hashCanonicalTree(b).root);
  });

  it('changes the digest when a file mode changes', () => {
    const dir = tree();
    const file = join(dir, 'python3.11');
    writeFileSync(file, '#!/bin/sh\n');
    chmodSync(file, 0o644);
    const before = hashCanonicalTree(dir).root;

    chmodSync(file, 0o755);

    expect(hashCanonicalTree(dir).root).not.toBe(before);
  });

  it('records a symlink by raw target bytes, not by dereferenced content', () => {
    const dir = tree();
    writeFileSync(join(dir, 'real.py'), 'x');
    writeFileSync(join(dir, 'other.py'), 'x'); // identical content
    symlinkSync('real.py', join(dir, 'link'));
    const before = hashCanonicalTree(dir).root;

    // Re-point the internal link at a byte-identical sibling: the tree must
    // still be considered different.
    rmSync(join(dir, 'link'));
    symlinkSync('other.py', join(dir, 'link'));

    expect(hashCanonicalTree(dir).root).not.toBe(before);
    const entries = walkCanonicalTree(dir);
    const link = entries.find((e) => e.path === 'link');
    expect(link).toMatchObject({ kind: 'symlink', normalizedTarget: 'other.py' });
  });

  it('rejects a symlink that escapes the tree root', () => {
    const dir = tree();
    symlinkSync('/etc/hosts', join(dir, 'escape'));

    expect(() => hashCanonicalTree(dir)).toThrow(CanonicalTreeRejectedError);
    expect(() => hashCanonicalTree(dir)).toThrow(/symlink_escapes_root/);
  });

  it('rejects a hardlink instead of guessing alias semantics', () => {
    const dir = tree();
    writeFileSync(join(dir, 'a.py'), 'a');
    linkSync(join(dir, 'a.py'), join(dir, 'b.py'));

    expect(() => hashCanonicalTree(dir)).toThrow(/hardlink_rejected/);
  });

  it('rejects a special filesystem node', () => {
    const dir = tree();
    try {
      execFileSync('/usr/bin/mkfifo', [join(dir, 'pipe')]);
    } catch {
      return; // platform without mkfifo: nothing to assert
    }

    expect(() => hashCanonicalTree(dir)).toThrow(/special_node_rejected/);
  });

  it('detects an input that changed while being copied', () => {
    const dir = tree();
    writeFileSync(join(dir, 'server.py'), 'v1');
    const before = hashCanonicalTree(dir);
    writeFileSync(join(dir, 'server.py'), 'v2');
    const after = hashCanonicalTree(dir);

    expect(() => assertStableMaterialisation({ before, after, snapshot: after }))
      .toThrow(/input_changed_during_copy/);
  });

  it('detects a snapshot that does not match a stable input', () => {
    const input = tree();
    writeFileSync(join(input, 'server.py'), 'v1');
    const snapshotDir = tree();
    writeFileSync(join(snapshotDir, 'server.py'), 'tampered');

    const before = hashCanonicalTree(input);
    expect(() => assertStableMaterialisation({
      before, after: before, snapshot: hashCanonicalTree(snapshotDir),
    })).toThrow(/snapshot_mismatch/);
  });

  it('accepts a faithful copy', () => {
    const input = tree();
    mkdirSync(join(input, 'pkg'));
    writeFileSync(join(input, 'pkg', 'mod.py'), 'code');
    symlinkSync('mod.py', join(input, 'pkg', 'alias.py'));

    const snapshotDir = tree();
    mkdirSync(join(snapshotDir, 'pkg'));
    writeFileSync(join(snapshotDir, 'pkg', 'mod.py'), 'code');
    symlinkSync('mod.py', join(snapshotDir, 'pkg', 'alias.py'));

    const before = hashCanonicalTree(input);
    expect(() => assertStableMaterialisation({
      before, after: hashCanonicalTree(input), snapshot: hashCanonicalTree(snapshotDir),
    })).not.toThrow();
  });
});
