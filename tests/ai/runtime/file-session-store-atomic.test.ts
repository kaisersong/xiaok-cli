import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FileSessionStore } from '../../../src/ai/runtime/session-store/file-store.js';
import type { PersistedSessionSnapshot } from '../../../src/ai/runtime/session-store/store.js';
import type { AtomicWriteFile } from '../../../src/utils/atomic-file.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function snapshot(sessionId: string, updatedAt: number): PersistedSessionSnapshot {
  return {
    sessionId,
    cwd: '/workspace',
    createdAt: updatedAt,
    updatedAt,
    lineage: [sessionId],
    messages: [{ role: 'user', content: [{ type: 'text', text: sessionId }] }],
    usage: { inputTokens: 1, outputTokens: 0 },
    compactions: [],
    memoryRefs: [],
    approvalRefs: [],
    backgroundJobRefs: [],
  };
}

describe('FileSessionStore atomic persistence', () => {
  it.each(['snapshot', 'pointer'])('rejects an asynchronous atomic writer at the %s barrier', async target => {
    const root = mkdtempSync(join(tmpdir(), 'xiaok-session-async-')); roots.push(root);
    const { writeFileAtomicallySync } = await import('../../../src/utils/atomic-file.js');
    const store = new FileSessionStore(root, (path, text, options) => {
      if ((target === 'pointer') === path.endsWith('last_session')) return Promise.reject(new Error('async write rejected'));
      writeFileAtomicallySync(path, text, options);
    });
    const saved = snapshot('sess_async', 100);
    saved.protectedObservationClosure = { version: 1, requiresReauthorization: true, observations: [{ authorityId: '00000000-0000-4000-8000-000000000000', profileId: 'p', sourceSessionId: saved.sessionId,
      ownerAgentId: 'owner', scopeId: 'scope', permissionGeneration: 1, observationId: 'observation', contentHash: 'a'.repeat(64), revision: 1, policyId: 'p', policyRevision: 1 }] };
    await expect(store.save(saved)).rejects.toThrow('session_atomic_write_must_be_synchronous');
    await new Promise(resolve => setImmediate(resolve));
  });
  it('keeps a valid pointer authoritative over a newer unrelated snapshot', async () => {
    const root = mkdtempSync(join(tmpdir(), 'xiaok-session-atomic-'));
    roots.push(root);
    const store = new FileSessionStore(root);
    await store.save(snapshot('sess_newer', 200));
    await store.save(snapshot('sess_pointer', 100));

    await expect(store.loadLast()).resolves.toMatchObject({
      sessionId: 'sess_pointer',
    });
  });

  it('falls back to the newest valid snapshot when the pointer is invalid', async () => {
    const root = mkdtempSync(join(tmpdir(), 'xiaok-session-atomic-'));
    roots.push(root);
    const store = new FileSessionStore(root);
    await store.save(snapshot('sess_old', 100));
    await store.save(snapshot('sess_new', 200));
    const pointerPath = join(root, 'last_session');
    await import('node:fs').then(({ writeFileSync }) =>
      writeFileSync(pointerPath, 'sess_missing', 'utf8')
    );

    await expect(store.loadLast()).resolves.toMatchObject({
      sessionId: 'sess_new',
    });
  });

  it('keeps a committed snapshot recoverable when pointer commit fails', async () => {
    const root = mkdtempSync(join(tmpdir(), 'xiaok-session-atomic-'));
    roots.push(root);
    const realWrite = (await import('../../../src/utils/atomic-file.js'))
      .writeFileAtomicallySync;
    const atomicWrite: AtomicWriteFile = (targetPath, contents, options) => {
      if (targetPath.endsWith('last_session')) {
        throw new Error('pointer commit failed');
      }
      realWrite(targetPath, contents, options);
    };
    const store = new FileSessionStore(root, atomicWrite);

    await expect(store.save(snapshot('sess_committed', 300))).rejects.toThrow(
      'pointer commit failed',
    );
    expect(JSON.parse(readFileSync(join(root, 'sess_committed.json'), 'utf8')))
      .toMatchObject({ sessionId: 'sess_committed' });
    await expect(store.load('sess_committed')).resolves.toMatchObject({
      sessionId: 'sess_committed',
    });
  });
});
