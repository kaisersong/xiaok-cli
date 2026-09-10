import { mkdtempSync, mkdirSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RoomWorkspaceLocalStore, prepareWorkspaceRoot, workspaceDigest } from '../../electron/room-workspace-local.js';
import { createRoomWorkspaceService } from '../../electron/room-workspace-service.js';

const cleanup: Array<() => void> = [];
afterEach(() => { for (const fn of cleanup.splice(0).reverse()) fn(); });
function setup(state: Record<string, unknown> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'room-workspace-service-')); const selected = join(root, '用户文件'); mkdirSync(selected);
  cleanup.push(() => rmSync(root, { recursive: true, force: true, maxRetries: 5 }));
  const store = new RoomWorkspaceLocalStore(join(root, 'workspace.db')); cleanup.push(() => store.close());
  const get = vi.fn(async () => ({ ok: true, config: null, permissions: { canManage: true, canRead: false }, claims: [], ...state }));
  const request = vi.fn(async (_room: string, _action: string, _input: Record<string, unknown>) => ({ ok: false, code: 'broker_unavailable' }));
  const service = createRoomWorkspaceService({ store, broker: { get, request }, isMutationOwner: () => true });
  return { root, selected, store, get, request, service };
}
describe('R3 workspace main service production boundary', () => {
  it('local command grants require a user manager, match the active binding, and persist locally', async () => {
    const {selected,store,get,request,service}=setup();
    const physical=await prepareWorkspaceRoot(selected);
    store.prepareBinding({...physical,roomId:'r',workspaceId:'w',bindingId:'b',generation:1,hostId:'h',requestId:'binding',createdBy:'user.local',payloadDigest:workspaceDigest('binding',physical)});
    store.activateBinding('b',{workspaceId:'w',activeBindingId:'b',generation:1});
    const state={ok:true,config:{workspaceId:'w',activeBindingId:'b',generation:1,originHostId:'h',phase:'active',revision:2},permissions:{canManage:true,canRead:true},claims:[]};
    get.mockResolvedValue(state as never);request.mockResolvedValue({ok:true} as never);
    expect((await service.getCollaborationRoomWorkspace({roomId:'r'})).localCommandsAllowed).toBe(true);
    const input={roomId:'r',bindingId:'b',generation:1,enabled:true,requestSource:'user' as const};
    expect((await service.setCollaborationRoomLocalCommands({...input,requestSource:'agent' as never})).ok).toBe(false);
    expect((await service.setCollaborationRoomLocalCommands({...input,bindingId:'stale'})).ok).toBe(false);
    expect((await service.setCollaborationRoomLocalCommands(input)).ok).toBe(true);
    expect((await service.getCollaborationRoomWorkspace({roomId:'r'})).localCommandsAllowed).toBe(true);
    get.mockResolvedValue({...state,permissions:{canManage:false,canRead:true}} as never);
    expect((await service.setCollaborationRoomLocalCommands({...input,enabled:false})).ok).toBe(false);
    get.mockResolvedValue(state as never);
    expect((await service.setCollaborationRoomLocalCommands({...input,enabled:false})).ok).toBe(true);
    expect((await service.getCollaborationRoomWorkspace({roomId:'r'})).localCommandsAllowed).toBe(false);
  });
  it('preserves authoritative management recovery when the local binding is unavailable', async () => {
    const { service } = setup({ config: { workspaceId: 'w1', activeBindingId: 'missing', generation: 2, phase: 'activation_failed', revision: 7, operationId: 'change-1' }, permissions: { canManage: true, canRead: true } });
    const snapshot = await service.getCollaborationRoomWorkspace({ roomId: 'r1' });
    expect(snapshot.ok).toBe(true);
    expect(snapshot.phase).toBe('activation_failed');
    expect(snapshot.operationId).toBe('change-1');
    expect(snapshot.revision).toBe(7);
    expect(snapshot.permissions).toMatchObject({ canManage: true, canRead: false });
    expect(snapshot.rootDisplayPath).toBeUndefined();
    expect(snapshot.artifacts).toEqual([]);
  });
  it('shows the durable mapping operation as updating while its delivery is pending', async () => {
    const { store, get, request } = setup({ config: { workspaceId: 'w', activeBindingId: 'b', generation: 1, phase: 'active', revision: 2 } });
    store.saveRecord('pending-mapping', 'key', { recordKey: 'key', roomId: 'r', projectId: 'p', operationId: 'op', applied: false });
    const service = createRoomWorkspaceService({ store, broker: { get, request }, isMutationOwner: () => true, getRoomProjects: async () => [{ id: 'p', name: 'Project', projectRevision: 1, workspaceMapping: { bindingId: 'b', generation: 1, state: 'active' } }] });
    expect((await service.getCollaborationRoomWorkspace({ roomId: 'r' })).projectMappings?.[0].state).toBe('updating');
  });
  it('does not strand a new mapping journal when authority explicitly rejects its fence', async () => {
    const { selected, store, get, request } = setup();
    const physical = await prepareWorkspaceRoot(selected);
    store.prepareBinding({ ...physical, roomId: 'r', workspaceId: 'w', bindingId: 'b', generation: 1, hostId: 'h', requestId: 'binding', createdBy: 'user.local', payloadDigest: workspaceDigest('binding', physical) });
    store.activateBinding('b', { workspaceId: 'w', activeBindingId: 'b', generation: 1 });
    get.mockResolvedValue({ ok: true, config: { workspaceId: 'w', activeBindingId: 'b', generation: 1, originHostId: 'h', phase: 'active', revision: 2 }, permissions: { canManage: true, canRead: false }, claims: [] } as never);
    request.mockResolvedValue({ ok: false, code: 'workspace_revision_conflict' });
    const service = createRoomWorkspaceService({ store, broker: { get, request }, isMutationOwner: () => true, kswarmRequest: async () => { throw new Error('must not apply'); } });
    for (const idempotencyKey of ['first', 'second']) expect((await service.mapCollaborationRoomWorkspaceProject({ roomId: 'r', projectId: 'p', expectedRevision: 1, expectedProjectRevision: 1, idempotencyKey, workFolderRelativePath: '', artifactsRelativePath: '' })).code).toBe('workspace_revision_conflict');
    expect(store.listRecords<any>('pending-mapping').every(record => record.cancelled)).toBe(true);
  });
  it('previews actual new-root collisions and template type conflicts before changing any config', async () => {
    const { selected, service } = setup();
    mkdirSync(join(selected, 'existing'));
    const rootConflict = await service.previewCollaborationRoomWorkspace({ roomId: 'r1', expectedRevision: 0, mode: 'create', selectedPath: selected, directoryName: 'existing', templateEntries: [] });
    expect(rootConflict.canCommit).toBe(false);
    writeFileSync(join(selected, 'not-a-dir'), 'mine');
    const templateConflict = await service.previewCollaborationRoomWorkspace({ roomId: 'r1', expectedRevision: 0, mode: 'existing', selectedPath: selected, templateEntries: [{ kind: 'directory', relativePath: 'not-a-dir' }] });
    expect(templateConflict.canCommit).toBe(false); expect(templateConflict.conflicts).toContain('not-a-dir');
  });
  it('T03 existing/new/template previews and cancel write no user files', async () => {
    const { selected, service } = setup();
    const preview = await service.previewCollaborationRoomWorkspace({ roomId: 'r1', expectedRevision: 0, mode: 'create', selectedPath: selected, directoryName: '自定义', templateEntries: [{ relativePath: '任意.md', kind: 'file', content: 'draft' }] });
    expect(preview.ok).toBe(true); expect(preview.canCommit).toBe(true);
    expect(readdirSync(selected)).toEqual([]);
  });
  it('T04 checks owner before filesystem mutation and ignores renderer actor forgery', async () => {
    const { selected, service, request } = setup({ permissions: { canManage: false, canRead: false } });
    const result = await service.previewCollaborationRoomWorkspace({ roomId: 'r1', expectedRevision: 0, mode: 'create', selectedPath: selected, directoryName: 'must-not-exist', templateEntries: [], requestSource: 'user', actor: { role: 'owner' } } as never);
    expect(result.ok).toBe(false); expect(readdirSync(selected)).toEqual([]); expect(request).not.toHaveBeenCalled();
  });
  it('T05 broker failure after preview cannot create root or use old permission cache', async () => {
    const { selected, service, get } = setup();
    const preview = await service.previewCollaborationRoomWorkspace({ roomId: 'r1', expectedRevision: 0, mode: 'create', selectedPath: selected, directoryName: 'not-created', templateEntries: [] });
    get.mockRejectedValueOnce(new Error('offline'));
    const result = await service.commitCollaborationRoomWorkspace({ roomId: 'r1', previewId: preview.previewId!, expectedRevision: 0, idempotencyKey: 'k1', confirmOverlap: true, confirmSharedReadGrant: true });
    expect(result.ok).toBe(false); expect(readdirSync(selected)).toEqual([]);
  });
  it('T19 never exposes path/index/read bytes without fresh read grant', async () => {
    const { selected, store, service, get, request } = setup();
    writeFileSync(join(selected, 'secret.txt'), 'sensitive');
    const physical = await prepareWorkspaceRoot(selected);
    store.prepareBinding({ ...physical, roomId: 'r1', workspaceId: 'w1', bindingId: 'b1', generation: 1, hostId: 'host1', requestId: 'req', createdBy: 'user.local', payloadDigest: workspaceDigest('binding', physical) });
    store.activateBinding('b1', { workspaceId: 'w1', activeBindingId: 'b1', generation: 1 });
    get.mockResolvedValue({ ok: true, config: { workspaceId: 'w1', activeBindingId: 'b1', generation: 1, phase: 'active', revision: 1 }, permissions: { canManage: false, canRead: false }, claims: [] } as never);
    request.mockResolvedValue({ ok: false, code: 'workspace_read_denied' });
    const result = await service.previewCollaborationRoomWorkspaceFile({ roomId: 'r1', bindingId: 'b1', generation: 1, relativePath: 'secret.txt' });
    expect(result.ok).toBe(false); expect(JSON.stringify(result)).not.toContain('sensitive');
    const listing = await service.listCollaborationRoomWorkspaceFiles({ roomId: 'r1', bindingId: 'b1', generation: 1, relativePath: '' });
    expect(listing.entries).toEqual([]);
  });
  it('lists only explicitly authorized historical versions without granting retired-root browsing', async () => {
    const { selected, store, service, get, request } = setup();
    writeFileSync(join(selected, 'old.txt'), 'historic');
    const physical = await prepareWorkspaceRoot(selected);
    store.prepareBinding({ ...physical, roomId: 'r1', workspaceId: 'w1', bindingId: 'old', generation: 1, hostId: 'h1', requestId: 'old-request', createdBy: 'user.local', payloadDigest: workspaceDigest('binding', physical) });
    const manifest = { roomId: 'r1', workspaceId: 'w1', bindingId: 'old', generation: 1, contextScope: { kind: 'room_only' }, artifacts: [{ relativePath: 'old.txt', contentHash: 'different-old-hash' }] };
    const payloadDigest = workspaceDigest('manifest', manifest);
    store.prepareSubmission({ subjectKey: 'u', submissionId: 's', payloadDigest, manifest });
    store.commitSubmission('u', { ticketId: 't', submissionId: 's', payloadDigest, commitSequence: 1 });
    const versionId = store.listArtifacts('r1')[0].versionId;
    get.mockResolvedValue({ ok: true, config: { workspaceId: 'w1', activeBindingId: 'new', generation: 2, originHostId: 'h1', phase: 'active', revision: 4 }, permissions: { canManage: false, canRead: false }, claims: [] } as never);
    request.mockImplementation(async (_room, action, input) => ({ ok: action === 'authorize-read' && input.versionId === versionId, code: 'workspace_read_denied' }) as never);
    const snapshot = await service.getCollaborationRoomWorkspace({ roomId: 'r1' });
    expect(snapshot.permissions).toMatchObject({ canRead: false, canReadArtifacts: true });
    expect(snapshot.artifacts).toHaveLength(1);
    expect(snapshot.artifacts[0].state).toBe('changed');
    expect(snapshot.rootDisplayPath).toBeUndefined();
    expect((await service.listCollaborationRoomWorkspaceFiles({ roomId: 'r1', bindingId: 'old', generation: 1, relativePath: '' })).ok).toBe(false);
    request.mockResolvedValue({ ok: false, code: 'workspace_read_denied' });
    expect((await service.getCollaborationRoomWorkspace({ roomId: 'r1' })).artifacts).toEqual([]);
  });
});
