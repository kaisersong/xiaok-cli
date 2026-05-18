import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { JsonHarnessMemoryStore } from '../../../src/runtime/harness-memory/store.js';

describe('JsonHarnessMemoryStore', () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it('creates candidates, lists scoped active memory, and expires records', () => {
    const root = mkdtempSync(join(tmpdir(), 'xiaok-harness-memory-'));
    roots.push(root);
    const store = new JsonHarnessMemoryStore(join(root, 'memory.json'));

    const record = store.createCandidate({
      category: 'empty_artifact',
      summary: 'Require artifact evidence before completion',
      scope: { repo: '/repo/a', runtime: 'xiaok-cli' },
      evidence: [{ traceBundlePath: '/trace/a.json', evidenceIds: ['task:item-1'], sessionId: 'sess-1' }],
    });
    store.promote(record.id, {
      promotedBy: 'human',
      reason: 'confirmed production failure',
      evidence: [{ traceBundlePath: '/trace/a.json', evidenceIds: ['task:item-1'], sessionId: 'sess-1' }],
    });

    expect(store.listActive({ repo: '/repo/a', runtime: 'xiaok-cli' })).toEqual([
      expect.objectContaining({ id: record.id, status: 'active' }),
    ]);
    expect(store.listActive({ repo: '/repo/b', runtime: 'xiaok-cli' })).toEqual([]);

    store.expire(record.id, 'stale');
    expect(store.listActive({ repo: '/repo/a', runtime: 'xiaok-cli' })).toEqual([]);
    expect(readFileSync(join(root, 'memory.json'), 'utf8')).toContain('"status": "expired"');
  });
});
