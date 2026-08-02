import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  assertPluginRelativePath,
  computeGitTreeSha256,
  detectPathConflicts,
  sha256Hex,
  type GitObjectEntry,
} from '../../../src/platform/plugins/install/integrity.js';

function entry(path: string, content: string, mode = '100644'): GitObjectEntry {
  return { mode, path, contentSha256: sha256Hex(Buffer.from(content, 'utf8')) };
}

describe('plugin install integrity', () => {
  it('matches the cross-repo golden digest vector', () => {
    // Same vector is asserted by kai-xiaok-plugins/tests/registry-integrity.test.mjs
    // so the registry generator and the installer can never drift apart.
    const entries: GitObjectEntry[] = [
      { mode: '100644', path: 'plugin.json', contentSha256: sha256Hex(Buffer.from('x')) },
      { mode: '100755', path: 'bin/run.sh', contentSha256: sha256Hex(Buffer.from('#!/bin/sh\n')) },
    ];

    expect(computeGitTreeSha256(entries)).toBe(
      'a2d0de20feda198a01ebb43d86f5ec8c2545234c2f26b64bfe9c830b4c50ed5f',
    );
  });

  it('computes a stable digest that is independent of entry ordering', () => {
    const a = entry('plugin.json', '{"name":"demo"}');
    const b = entry('skills/demo.md', '# demo');

    const forward = computeGitTreeSha256([a, b]);
    const reverse = computeGitTreeSha256([b, a]);

    expect(forward).toMatch(/^[0-9a-f]{64}$/);
    expect(forward).toBe(reverse);
  });

  it('changes the digest when content, mode or path changes', () => {
    const base = [entry('plugin.json', '{"name":"demo"}'), entry('bin/run.sh', 'echo hi', '100755')];
    const baseline = computeGitTreeSha256(base);

    expect(computeGitTreeSha256([base[0], entry('bin/run.sh', 'echo bye', '100755')])).not.toBe(baseline);
    expect(computeGitTreeSha256([base[0], entry('bin/run.sh', 'echo hi', '100644')])).not.toBe(baseline);
    expect(computeGitTreeSha256([base[0], entry('bin/run2.sh', 'echo hi', '100755')])).not.toBe(baseline);
  });

  it('is not confusable by paths containing the record separators', () => {
    const collidingA = [entry('a', 'x'), entry('b', 'y')];
    const collidingB = [entry('a\tb', 'x'), entry('y', 'y')];

    expect(computeGitTreeSha256(collidingA)).not.toBe(computeGitTreeSha256(collidingB));
  });

  it('rejects unsupported git modes such as gitlinks and directories', () => {
    expect(() => computeGitTreeSha256([{ mode: '160000', path: 'vendor', contentSha256: 'a'.repeat(64) }]))
      .toThrow(/gitlink|submodule/i);
    expect(() => computeGitTreeSha256([{ mode: '040000', path: 'dir', contentSha256: 'a'.repeat(64) }]))
      .toThrow(/mode/i);
  });

  it('rejects duplicate and non-normalized digest inputs', () => {
    const duplicate = [entry('plugin.json', 'a'), entry('plugin.json', 'b')];
    expect(() => computeGitTreeSha256(duplicate)).toThrow(/duplicate/i);
    expect(() => computeGitTreeSha256([{ mode: '100644', path: 'x', contentSha256: 'NOTHEX' }]))
      .toThrow(/sha-?256/i);
  });

  it('detects case-insensitive and unicode normalization path conflicts', () => {
    expect(detectPathConflicts(['a/b.txt', 'a/c.txt'])).toEqual([]);
    expect(detectPathConflicts(['a/B.txt', 'a/b.txt'])[0]).toMatch(/b\.txt/i);
    // U+00E9 vs e + U+0301 normalize to the same NFC form.
    expect(detectPathConflicts(['caf\u00e9.md', 'cafe\u0301.md']).length).toBe(1);
  });

  it('rejects relative paths that escape the plugin root', () => {
    const root = join(tmpdir(), 'xiaok-plugin-root');

    expect(assertPluginRelativePath(root, 'mcp-servers/report-renderer')).toBe(
      join(root, 'mcp-servers', 'report-renderer'),
    );
    expect(() => assertPluginRelativePath(root, '../outside')).toThrow(/escape/i);
    expect(() => assertPluginRelativePath(root, '/etc/passwd')).toThrow(/absolute|escape/i);
    expect(() => assertPluginRelativePath(root, 'a/../../b')).toThrow(/escape/i);
    expect(() => assertPluginRelativePath(root, 'a\0b')).toThrow(/invalid/i);
    expect(() => assertPluginRelativePath(root, '-rf')).toThrow(/option/i);
  });
});
