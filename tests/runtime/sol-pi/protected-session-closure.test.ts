import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AgentSessionState } from '../../../src/ai/runtime/session.js';
import { FileSessionStore } from '../../../src/ai/runtime/session-store/file-store.js';
import { SQLiteSessionStore } from '../../../src/ai/runtime/session-store/sqlite-store.js';
import { mergeProtectedObservationClosures } from '../../../src/ai/runtime/protected-observation-closure.js';

const ref = { authorityId: 'af14bafe-0b46-42df-93c3-7fb27e36379a', profileId: 'profile', sourceSessionId: 'source', ownerAgentId: 'owner', scopeId: 'scope', permissionGeneration: 1,
  observationId: 'observation-1', contentHash: 'a'.repeat(64), revision: 2, policyId: 'policy', policyRevision: 1 };
const closure = () => ({ version: 1 as const, requiresReauthorization: true as const, observations: [{ ...ref }] });
const snapshot = () => ({ ...new AgentSessionState().exportSnapshot(), sessionId: 'session', model: 'test' });
describe('durable protected observation closure', () => {
  const cleanup: Array<() => void> = [];
  afterEach(() => { for (const fn of cleanup.splice(0).reverse()) fn(); });
  it('cannot clear graph protection by message replacement, compaction or restoring stale snapshot', () => {
    const session = new AgentSessionState(); const stale = session.exportSnapshot();
    session.addProtectedObservationReferences([ref]);
    for (let i = 0; i < 6; i++) { session.appendUserText(`question ${i}`); session.appendAssistantBlocks([{ type: 'text', text: 'old context '.repeat(200) }]); }
    session.applyCompaction(session.planCompaction(), 'summary'); session.replaceMessages([]); session.restoreSnapshot(stale);
    expect(session.getProtectedObservationClosure()).toEqual(closure());
    const copy = session.getProtectedObservationClosure()!; copy.observations.length = 0;
    expect(session.exportSnapshot().protectedObservationClosure).toEqual(closure());
  });
  it('rejects conflicting identities and arbitrary body metadata rather than normalizing it away', () => {
    expect(() => mergeProtectedObservationClosures(closure(), { ...closure(), observations: [{ ...ref, contentHash: 'b'.repeat(64) }] })).toThrow();
    expect(() => mergeProtectedObservationClosures(undefined, { ...closure(), body: 'secret' } as never)).toThrow();
    expect(() => mergeProtectedObservationClosures(undefined, { ...closure(), requiresReauthorization: false } as never)).toThrow();
    expect(() => mergeProtectedObservationClosures(undefined, { ...closure(), observations: [{ ...ref, credentials: 'secret' }] } as never)).toThrow();
  });
  for (const kind of ['file', 'sqlite'] as const) {
    it(`${kind} saves and forks closure, merging stale saves from a second store instance`, async () => {
      const root = mkdtempSync(join(tmpdir(), 'xiaok-protected-')); cleanup.push(() => rmSync(root, { recursive: true, force: true }));
      const make = () => kind === 'file' ? new FileSessionStore(root) : new SQLiteSessionStore(join(root, 'sessions.sqlite'));
      const first = make(), second = make(); if (first instanceof SQLiteSessionStore) cleanup.push(() => first.dispose()); if (second instanceof SQLiteSessionStore) cleanup.push(() => second.dispose());
      const stale = snapshot(); await first.save(stale);
      await first.save({ ...stale, protectedObservationClosure: closure() });
      await second.save({ ...stale, messages: [{ role: 'user', content: [{ type: 'text', text: 'stale writer' }] }] });
      expect((await first.load('session'))?.protectedObservationClosure).toEqual(closure());
      const secondClosure = { ...closure(), observations: [{ ...ref, observationId: 'observation-2' }] };
      await second.save({ ...stale, protectedObservationClosure: secondClosure });
      const expected = mergeProtectedObservationClosures(closure(), secondClosure);
      const forked = await first.fork('session'); expect(forked.protectedObservationClosure).toEqual(expected);
      expect(forked.sessionId).not.toBe('source'); expect(forked.protectedObservationClosure?.observations[0]?.sourceSessionId).toBe('source');
      await expect(second.save({ ...stale, protectedObservationClosure: { ...closure(), observations: [{ ...ref, scopeId: 'other' }] } })).rejects.toThrow();
      expect((await first.load('session'))?.protectedObservationClosure).toEqual(expected);
    });
  }
  it('refuses an existing file save lock without deleting it or overwriting history', async () => {
    const root = mkdtempSync(join(tmpdir(), 'xiaok-protected-lock-')); cleanup.push(() => rmSync(root, { recursive: true, force: true }));
    const store = new FileSessionStore(root); await store.save({ ...snapshot(), protectedObservationClosure: closure() });
    writeFileSync(join(root, 'session.json.save-lock'), 'another process');
    await expect(store.save(snapshot())).rejects.toThrow();
    expect((await store.load('session'))?.protectedObservationClosure).toEqual(closure());
  });
  it('failed atomic file save cannot acknowledge a new reference or leave its own save lock', async () => {
    const root = mkdtempSync(join(tmpdir(), 'xiaok-protected-failure-')); cleanup.push(() => rmSync(root, { recursive: true, force: true }));
    const store = new FileSessionStore(root); await store.save({ ...snapshot(), protectedObservationClosure: closure() });
    const failed = new FileSessionStore(root, () => { throw new Error('disk_write_failed'); });
    await expect(failed.save({ ...snapshot(), protectedObservationClosure: { ...closure(), observations: [{ ...ref, observationId: 'new-reference' }] } })).rejects.toThrow('disk_write_failed');
    expect((await store.load('session'))?.protectedObservationClosure).toEqual(closure());
    expect(existsSync(join(root, 'session.json.save-lock'))).toBe(false);
  });
  it('rejects corrupted closure on file restore rather than loading unprotected history', async () => {
    const root = mkdtempSync(join(tmpdir(), 'xiaok-protected-corrupt-')); cleanup.push(() => rmSync(root, { recursive: true, force: true }));
    const store = new FileSessionStore(root); await store.save({ ...snapshot(), protectedObservationClosure: closure() });
    const path = join(root, 'session.json'); const doc = JSON.parse(readFileSync(path, 'utf8'));
    doc.protectedObservationClosure.requiresReauthorization = false; writeFileSync(path, JSON.stringify(doc));
    await expect(store.load('session')).rejects.toThrow('protected_observation_closure_invalid');
    await expect(store.save(snapshot())).rejects.toThrow('protected_observation_closure_invalid');
  });

  it('advances restore generation even for same snapshot or a rejected restore', () => {
    const session = new AgentSessionState(); expect(session.getObservationRestoreGeneration()).toBe(0);
    session.addProtectedObservationReferences([ref]); const original = session.exportSnapshot();
    session.replaceMessages([]); expect(session.getObservationRestoreGeneration()).toBe(0);
    session.restoreSnapshot(original); expect(session.getObservationRestoreGeneration()).toBe(1);
    session.restoreSnapshot(original); expect(session.getObservationRestoreGeneration()).toBe(2);
    expect(() => session.restoreSnapshot({ ...original, protectedObservationClosure: { ...closure(), requiresReauthorization: false } } as never)).toThrow();
    expect(session.getObservationRestoreGeneration()).toBe(3);
    expect(session.getProtectedObservationClosure()).toEqual(closure());
  });

  it('does not overwrite an existing snapshot with unknown schema as if it were missing', async () => {
    const root = mkdtempSync(join(tmpdir(), 'xiaok-protected-schema-')); cleanup.push(() => rmSync(root, { recursive: true, force: true }));
    const store = new FileSessionStore(root); await store.save({ ...snapshot(), protectedObservationClosure: closure() });
    const path = join(root, 'session.json'); const doc = JSON.parse(readFileSync(path, 'utf8')); doc.schemaVersion = 999;
    const raw = JSON.stringify(doc); writeFileSync(path, raw);
    await expect(store.load('session')).rejects.toThrow(); await expect(store.save(snapshot())).rejects.toThrow();
    expect(readFileSync(path, 'utf8')).toBe(raw);
  });

});
