import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, symlinkSync, renameSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, win32 } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { RoomWorkspaceLocalStore, canonicalWorkspaceJson, workspaceDigest, pathWithin, prepareWorkspaceRoot, resolveWorkspacePath, observeWorkspaceFile, managedWorkspaceWrite, previewWorkspaceTemplate, applyWorkspaceTemplate } from '../../electron/room-workspace-local.js';

const roots: string[] = [];
function fixture() { const root = mkdtempSync(join(tmpdir(), 'room-workspace-')); roots.push(root); return root; }
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 5 }); });

describe('R3 workspace canonical protocol', () => {
  it('orders object keys but preserves ordered arrays and rejects noncanonical inputs', () => {
    expect(canonicalWorkspaceJson({ z: [2, 1], a: { b: '中文', a: true } })).toBe('{"a":{"a":true,"b":"中文"},"z":[2,1]}');
    expect(workspaceDigest('binding', { b: 2, a: 1 })).toBe(workspaceDigest('binding', { a: 1, b: 2 }));
    expect(workspaceDigest('binding', {})).not.toBe(workspaceDigest('manifest', {}));
    for (const invalid of [undefined, NaN, Infinity, 1.5, { x: undefined }, new Date(), [undefined]]) expect(() => canonicalWorkspaceJson(invalid)).toThrow();
  });
  it('uses Windows case and path component boundaries, including UNC and drives', () => {
    expect(pathWithin('C:\\Work', 'c:\\work\\文档.txt', win32)).toBe(true);
    expect(pathWithin('C:\\Work', 'C:\\Workspace\\a', win32)).toBe(false);
    expect(pathWithin('C:\\Work', 'D:\\Work\\a', win32)).toBe(false);
    expect(pathWithin('\\\\srv\\share\\Work', '\\\\srv\\share\\work\\a', win32)).toBe(true);
  });
});

describe('R3 T02/T03/T10 real workspace filesystem', () => {
  it('prepares custom root without creating any product-owned directory', async () => {
    const root = fixture(); const selected = join(root, '任意 工作'); mkdirSync(selected);
    const binding = await prepareWorkspaceRoot(selected);
    expect(readdirSync(selected)).toEqual([]);
    expect(await resolveWorkspacePath(binding, '')).toBe(binding.canonicalRoot);
    for (const path of ['../outside', '..\\outside', 'C:\\secret', '\\\\server\\share', '/outside']) {
      await expect(resolveWorkspacePath(binding, path)).rejects.toThrow();
    }
  });
  it('detects replaced root and never recreates missing selected paths', async () => {
    const root = fixture(); const selected = join(root, 'chosen'); mkdirSync(selected);
    const binding = await prepareWorkspaceRoot(selected); renameSync(selected, join(root, 'old')); mkdirSync(selected);
    await expect(resolveWorkspacePath(binding, '')).rejects.toThrow('workspace_identity_changed');
    await expect(prepareWorkspaceRoot(join(root, 'missing'))).rejects.toThrow();
    expect(readdirSync(root).sort()).toEqual(['chosen', 'old']);
  });
  it('rejects parent and terminal symlinks escaping root before reads/writes', async () => {
    const root = fixture(); const chosen = join(root, 'chosen'); const outside = join(root, 'outside');
    mkdirSync(chosen); mkdirSync(outside); writeFileSync(join(outside, 'secret'), 'secret');
    symlinkSync(outside, join(chosen, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
    const binding = await prepareWorkspaceRoot(chosen);
    await expect(resolveWorkspacePath(binding, 'escape/secret')).rejects.toThrow('workspace_path_escape');
    await expect(resolveWorkspacePath(binding, 'escape')).rejects.toThrow('workspace_path_escape');
    await expect(managedWorkspaceWrite(binding, 'escape/new', 'bad', null)).rejects.toThrow();
    expect(readdirSync(outside)).toEqual(['secret']);
  });
  it('preview is zero write and confirmation never overwrites conflicting files', async () => {
    const root = fixture(); const binding = await prepareWorkspaceRoot(root); writeFileSync(join(root, '既有.txt'), 'mine');
    const template = [{ relativePath: '自选', kind: 'directory' as const }, { relativePath: '既有.txt', kind: 'file' as const, text: 'overwrite' }, { relativePath: '自选/说明.md', kind: 'file' as const, text: '规则' }];
    const preview = await previewWorkspaceTemplate(binding, template);
    expect(preview[1].state).toBe('exists'); expect(readdirSync(root)).toEqual(['既有.txt']);
    await applyWorkspaceTemplate(binding, template);
    expect(readFileSync(join(root, '既有.txt'), 'utf8')).toBe('mine');
    expect(readFileSync(join(root, '自选', '说明.md'), 'utf8')).toBe('规则');
    await applyWorkspaceTemplate(binding, template);
    expect(readFileSync(join(root, '既有.txt'), 'utf8')).toBe('mine');
  });
  it('T11/T18 serializes same physical target across binding objects and refuses stale hash', async () => {
    const root = fixture(); const binding = await prepareWorkspaceRoot(root); const other = await prepareWorkspaceRoot(root);
    await managedWorkspaceWrite(binding, 'a.txt', 'initial', null);
    const initial = await observeWorkspaceFile(binding, 'a.txt');
    const results = await Promise.allSettled([managedWorkspaceWrite(binding, 'a.txt', 'one', initial.contentHash), managedWorkspaceWrite(other, 'a.txt', 'two', initial.contentHash)]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(r => r.status === 'rejected')).toHaveLength(1);
    const current = await observeWorkspaceFile(binding, 'a.txt'); expect(current.contentHash).not.toBe(initial.contentHash);
    await expect(managedWorkspaceWrite(binding, 'a.txt', 'overwrite', null)).rejects.toThrow('workspace_write_conflict');
  });
});

describe('R3 durable local bindings and ticket outbox', () => {
  it('T05 preserves immutable preparation across restart and rejects same-key different payload', async () => {
    const root = fixture(); const dbPath = join(root, 'internal.db'); const selected = join(root, 'user'); mkdirSync(selected);
    const physical = await prepareWorkspaceRoot(selected);
    let store = new RoomWorkspaceLocalStore(dbPath);
    const input = { ...physical, roomId: 'r1', workspaceId: 'w1', hostId: 'h1', generation: 1, bindingId: 'b1', requestId: 'req1', createdBy: 'u1', payloadDigest: workspaceDigest('binding', physical) };
    expect(store.prepareBinding(input).state).toBe('prepared'); store.close();
    store = new RoomWorkspaceLocalStore(dbPath);
    try {
      expect(store.prepareBinding(input).bindingId).toBe('b1');
      expect(() => store.prepareBinding({ ...input, generation: 2 })).toThrow('workspace_idempotency_conflict');
      expect(() => store.activateBinding('b1', { workspaceId: 'w1', activeBindingId: 'other', generation: 1 })).toThrow();
      store.activateBinding('b1', { workspaceId: 'w1', activeBindingId: 'b1', generation: 1 });
      expect(store.getBinding('b1')?.state).toBe('active');
      expect(readdirSync(selected)).toEqual([]);
    } finally { store.close(); }
  });
  it('T12/T31 ticket registration and outbox are atomic, duplicate-safe and recoverable', () => {
    const root = fixture(); const dbPath = join(root, 'internal.db'); let store = new RoomWorkspaceLocalStore(dbPath);
    const manifest = { roomId: 'r1', bindingId: 'b1', generation: 1, contextScope: { kind: 'room_only' }, artifacts: [{ relativePath: 'a.txt', contentHash: 'hash' }] };
    const digest = workspaceDigest('manifest', manifest);
    store.prepareSubmission({ submissionId: 's1', subjectKey: 'user:u1:a1', payloadDigest: digest, manifest });
    const ticket = { ticketId: 't1', submissionId: 's1', payloadDigest: digest, commitSequence: 4 };
    store.commitSubmission('user:u1:a1', ticket); store.close(); store = new RoomWorkspaceLocalStore(dbPath);
    try {
      store.commitSubmission('user:u1:a1', ticket);
      expect(store.listArtifacts('r1')).toHaveLength(1);
      expect(store.pendingOutbox()).toHaveLength(1);
      expect(() => store.commitSubmission('user:u1:a1', { ...ticket, payloadDigest: 'different' })).toThrow();
      const event = store.pendingOutbox()[0]; store.acknowledgeOutbox(event.eventId);
      expect(store.pendingOutbox()).toHaveLength(0);
    } finally { store.close(); }
  });
});
