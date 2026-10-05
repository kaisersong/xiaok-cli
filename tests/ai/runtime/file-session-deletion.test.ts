import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { FileSessionStore } from '../../../src/ai/runtime/session-store/file-store.js';
import { AgentSessionState } from '../../../src/ai/runtime/session.js';
import { ReferenceDeletionReceiptStore } from '../../../src/runtime/sol-pi/reference-lifecycle.js';
const cleanup: Array<() => void> = [];
afterEach(() => { for (const close of cleanup.splice(0).reverse()) close(); });
async function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'solpi-user-delete-')); cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  const store = new FileSessionStore(join(root, 'sessions')); const receipts = new ReferenceDeletionReceiptStore(join(root, 'profile')); cleanup.push(() => receipts.close());
  const state = new AgentSessionState(); const snapshot = { ...state.exportSnapshot(), sessionId: 'sess_delete' };
  const ref = { authorityId: '00000000-0000-4000-8000-000000000000', profileId: 'p', sourceSessionId: snapshot.sessionId, ownerAgentId: 'owner', scopeId: 'scope', permissionGeneration: 1, observationId: 'observation', contentHash: 'a'.repeat(64), revision: 1, policyId: 'p', policyRevision: 1 };
  snapshot.protectedObservationClosure = { version: 1, requiresReauthorization: true, observations: [ref] };
  await store.save(snapshot);
  return { root, store, receipts, snapshot, ref, args: { requestSource: 'user' as const, sessionId: snapshot.sessionId, receipts } };
}
describe('explicit durable session deletion', () => {
  it('deletes the real snapshot, completes exact owner receipt and permanently refuses old saves', async () => {
    const f = await fixture(); await f.store.deleteSession(f.args);
    expect(existsSync(join(f.root, 'sessions', 'sess_delete.json'))).toBe(false);
    expect(await f.store.load('sess_delete')).toBeNull(); expect(await f.store.list()).toEqual([]);
    expect(f.receipts.resolve({ ...f.ref, referenceId: 'session:sess_delete' }).state).toBe('deleted');
    await expect(f.store.save(f.snapshot)).rejects.toThrow('session_deleted');
    await f.store.deleteSession(f.args);
  });
  it.each(['agent', 'scheduler'] as const)('refuses %s deletion before mutation', async requestSource => {
    const f = await fixture(); await expect(f.store.deleteSession({ ...f.args, requestSource })).rejects.toThrow('request_source');
    expect(await f.store.load('sess_delete')).not.toBeNull(); expect(f.receipts.pending()).toEqual([]);
  });
  it('refuses active ownership and path traversal', async () => {
    const f = await fixture(); const data = JSON.parse(readFileSync(join(f.root, 'sessions', 'sess_delete.json'), 'utf8'));
    data.intentDelegation = { ownership: { state: 'owned', ownerInstanceId: 'active' } };
    writeFileSync(join(f.root, 'sessions', 'sess_delete.json'), JSON.stringify(data));
    await expect(f.store.deleteSession(f.args)).rejects.toThrow('session_active');
    await expect(f.store.deleteSession({ ...f.args, sessionId: '../escape' })).rejects.toThrow('session_id');
  });
  it('refuses snapshot symlinks and missing snapshots without a deletion journal', async () => {
    const f = await fixture(); const file = join(f.root, 'sessions', 'sess_delete.json'); rmSync(file); symlinkSync(join(f.root, 'outside'), file);
    await expect(f.store.deleteSession(f.args)).rejects.toThrow(); rmSync(file);
    await expect(f.store.deleteSession(f.args)).rejects.toThrow('session_not_found'); expect(f.receipts.pending()).toEqual([]);
  });
  it('recovers a real unlink followed by receipt failure without using mere absence as proof', async () => {
    const f = await fixture(); const failed = { begin: f.receipts.begin.bind(f.receipts), complete() { throw new Error('injected receipt commit failure'); } };
    await expect(f.store.deleteSession({ ...f.args, receipts: failed })).rejects.toThrow('injected');
    expect(existsSync(join(f.root, 'sessions', 'sess_delete.json'))).toBe(false);
    expect(f.receipts.resolve({ ...f.ref, referenceId: 'session:sess_delete' }).state).toBe('unknown');
    await expect(f.store.save(f.snapshot)).rejects.toThrow('session_deleted');
    const reopened = new FileSessionStore(join(f.root, 'sessions')); await reopened.deleteSession(f.args);
    expect(f.receipts.resolve({ ...f.ref, referenceId: 'session:sess_delete' }).state).toBe('deleted');
  });
  it('pending receipt failure is visible to load/loadLast and safely resumes with the recorded snapshot', async () => {
    const f = await fixture(); const port = { begin() { throw new Error('receipt unavailable'); }, complete() {} };
    await expect(f.store.deleteSession({ ...f.args, receipts: port })).rejects.toThrow('receipt unavailable');
    expect(existsSync(join(f.root, 'sessions', 'sess_delete.json'))).toBe(true);
    await expect(f.store.load('sess_delete')).rejects.toThrow('session_deletion_pending');
    await expect(f.store.loadLast()).rejects.toThrow('session_deletion_pending');
    await expect(f.store.save(f.snapshot)).rejects.toThrow('session_deleted');
    await new FileSessionStore(join(f.root, 'sessions')).deleteSession(f.args);
    expect(await f.store.load('sess_delete')).toBeNull();
  });
  it('refuses changed snapshots during recovery and never completes their receipt', async () => {
    const f = await fixture(); const port = { begin() { throw new Error('pending'); }, complete() {} };
    await expect(f.store.deleteSession({ ...f.args, receipts: port })).rejects.toThrow('pending');
    writeFileSync(join(f.root, 'sessions', 'sess_delete.json'), '{}');
    await expect(f.store.deleteSession(f.args)).rejects.toThrow('snapshot_changed'); expect(f.receipts.pending()).toEqual([]);
  });
  it('never deletes after failed or asynchronous journal publication', async () => {
    const f = await fixture();
    const failed = new FileSessionStore(join(f.root, 'sessions'), () => { throw new Error('journal flush failed'); });
    await expect(failed.deleteSession(f.args)).rejects.toThrow('journal flush failed');
    const asynchronous = new FileSessionStore(join(f.root, 'sessions'), async () => { throw new Error('async failed'); });
    await expect(asynchronous.deleteSession(f.args)).rejects.toThrow('must_be_synchronous');
    expect(existsSync(join(f.root, 'sessions', 'sess_delete.json'))).toBe(true); expect(f.receipts.pending()).toEqual([]);
  });
  it('rejects corrupt markers and symlink journal roots on all save/load/delete paths', async () => {
    const f = await fixture(); await expect(f.store.deleteSession({ ...f.args, receipts: { begin() { throw new Error('pending'); }, complete() {} } })).rejects.toThrow();
    const marker = join(f.root, 'sessions', '.deletions', 'sess_delete.json'); writeFileSync(marker, '{}');
    await expect(f.store.save(f.snapshot)).rejects.toThrow('invalid_journal'); await expect(f.store.load('sess_delete')).rejects.toThrow('invalid_journal');
    await expect(f.store.deleteSession(f.args)).rejects.toThrow('invalid_journal');
    rmSync(join(f.root, 'sessions', '.deletions'), { recursive: true }); symlinkSync(f.root, join(f.root, 'sessions', '.deletions'));
    await expect(f.store.save(f.snapshot)).rejects.toThrow('unsafe_journal'); await expect(f.store.deleteSession(f.args)).rejects.toThrow('unsafe_journal');
  });
  it('retains the original source while an actual persisted fork still references it', async () => {
    const f = await fixture(); const fork = await f.store.fork(f.snapshot.sessionId);
    await expect(f.store.deleteSession(f.args)).rejects.toThrow('session_referenced');
    expect(f.receipts.resolve({ ...f.ref, referenceId: 'session:sess_delete' }).state).toBe('unknown');
    await f.store.deleteSession({ ...f.args, sessionId: fork.sessionId });
    expect(f.receipts.resolve({ ...f.ref, referenceId: 'session:sess_delete' }).state).toBe('unknown');
    await f.store.deleteSession(f.args);
    expect(f.receipts.resolve({ ...f.ref, referenceId: 'session:sess_delete' }).state).toBe('deleted');
  });
  it('rejects late copied closure saves after the source deletion and refuses unknown sibling snapshots', async () => {
    const f = await fixture(); writeFileSync(join(f.root, 'sessions', 'unknown.json'), '{broken');
    await expect(f.store.deleteSession(f.args)).rejects.toThrow('reference_census');
    rmSync(join(f.root, 'sessions', 'unknown.json')); await f.store.deleteSession(f.args);
    await expect(f.store.save({ ...f.snapshot, sessionId: 'late_fork' })).rejects.toThrow('source_deleted');
  });
  it('serializes a different-session save against deletion with the shared real store lock', async () => {
    const f = await fixture(); let concurrent: Promise<void> | undefined;
    const port = { begin(input: Parameters<ReferenceDeletionReceiptStore['begin']>[0]) { concurrent = f.store.save({ ...f.snapshot, sessionId: 'racing_fork' }); return f.receipts.begin(input); }, complete: f.receipts.complete.bind(f.receipts) };
    await f.store.deleteSession({ ...f.args, receipts: port }); await expect(concurrent).rejects.toThrow('session_save_locked');
    expect(await f.store.load('racing_fork')).toBeNull();
  });
  it('blocks an actual second-process copied-closure save while deletion owns the root lock', async () => {
    const f = await fixture(); let output = '';
    const module = pathToFileURL(resolve('src/ai/runtime/session-store/file-store.ts')).href;
    const script = `const {FileSessionStore}=await import(${JSON.stringify(module)});try{await new FileSessionStore(${JSON.stringify(join(f.root, 'sessions'))}).save(${JSON.stringify({ ...f.snapshot, sessionId: 'process_fork' })});console.log('UNSAFE_SAVED')}catch(e){console.log(e.message)}`;
    const port = { begin(input: Parameters<ReferenceDeletionReceiptStore['begin']>[0]) {
      const child = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], { encoding: 'utf8', timeout: 10000 });
      expect(child.status).toBe(0); output = child.stdout; return f.receipts.begin(input);
    }, complete: f.receipts.complete.bind(f.receipts) };
    await f.store.deleteSession({ ...f.args, receipts: port });
    expect(output).toContain('session_save_locked'); expect(output).not.toContain('UNSAFE_SAVED'); expect(await f.store.load('process_fork')).toBeNull();
  });
  it('durable pending journal blocks a competing actual save before snapshot deletion', async () => {
    const f = await fixture(); let concurrent: Promise<void> | undefined;
    const port = { begin(input: Parameters<ReferenceDeletionReceiptStore['begin']>[0]) { concurrent = f.store.save(f.snapshot); return f.receipts.begin(input); }, complete: f.receipts.complete.bind(f.receipts) };
    await f.store.deleteSession({ ...f.args, receipts: port }); await expect(concurrent).rejects.toThrow('session_save_locked');
  });
});
