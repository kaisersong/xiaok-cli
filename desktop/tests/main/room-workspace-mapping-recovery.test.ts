import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { RoomWorkspaceLocalStore } from '../../electron/room-workspace-local.js';
import { createRoomWorkspaceMappingRecovery } from '../../electron/room-workspace-mapping-recovery.js';

describe('main mapping durable replay', () => {
  it.each(['roomId', 'projectId', 'operationId', 'bindingId', 'generation'])('does not settle another operation cancellation receipt with mismatched %s', async (key) => {
    const root = mkdtempSync(join(tmpdir(), 'room-mapping-cancel-deny-'));
    const store = new RoomWorkspaceLocalStore(join(root, 'local.db'));
    store.saveRecord('pending-mapping', 'op', { recordKey: 'op', roomId: 'r', projectId: 'p', operationId: 'op', payloadDigest: 'digest', payload: { bindingId: 'b', generation: 1 }, applied: false });
    const calls: string[] = [];
    try {
      const recovery = createRoomWorkspaceMappingRecovery({ store, isMutationOwner: () => true, broker: { request: async (_room, action) => {
        calls.push(action);
        return action === 'recover-mapping-ticket' ? { ok: false, code: 'workspace_ticket_mismatch' } : { ok: true, mapping: { roomId: 'r', projectId: 'p', operationId: 'op', bindingId: 'b', generation: 1, state: 'cancelled', [key]: 'other' } };
      } }, kswarmRequest: async () => { throw new Error('must not apply'); } });
      expect(await recovery.recover()).toEqual([]);
      expect(store.getRecord<any>('pending-mapping', 'op').cancelled).toBeUndefined();
      expect(calls).toEqual(['recover-mapping-ticket', 'recover-mapping-operation']);
    } finally { store.close(); rmSync(root, { recursive: true, force: true, maxRetries: 5 }); }
  });
  it('recovers a lost cancellation acknowledgement after reopening the local journal', async () => {
    const root = mkdtempSync(join(tmpdir(), 'room-mapping-cancel-ack-'));
    let store = new RoomWorkspaceLocalStore(join(root, 'local.db'));
    const record = { recordKey: 'op', roomId: 'r', projectId: 'p', operationId: 'op', payloadDigest: 'digest', payload: { bindingId: 'b', generation: 1 }, applied: false };
    store.saveRecord('pending-mapping', 'op', record);
    let cancelled = false;
    const calls: string[] = [];
    const broker = { request: async (_room: string, action: string) => {
      calls.push(action);
      if (action === 'recover-mapping-ticket') return { ok: false, code: 'workspace_ticket_mismatch' };
      if (action === 'recover-mapping-operation') return { ok: true, mapping: { roomId: 'r', projectId: 'p', operationId: 'op', bindingId: 'b', generation: 1, state: cancelled ? 'cancelled' : 'updating' } };
      if (action === 'cancel-mapping') { cancelled = true; throw new Error('ack lost'); }
      throw new Error('unexpected authority request');
    } };
    const makeRecovery = () => createRoomWorkspaceMappingRecovery({ store, isMutationOwner: () => true, broker, kswarmRequest: async () => { throw new Error('must not apply'); } });
    try {
      expect(await makeRecovery().recover()).toEqual([]);
      expect(cancelled).toBe(true);
      store.close(); store = new RoomWorkspaceLocalStore(join(root, 'local.db'));
      expect(await makeRecovery().recover()).toEqual(['r']);
      expect(store.getRecord<any>('pending-mapping', 'op').cancelled).toBe(true);
      expect(await makeRecovery().recover()).toEqual([]);
      expect(calls.filter(action => action === 'cancel-mapping')).toHaveLength(1);
    } finally { store.close(); rmSync(root, { recursive: true, force: true, maxRetries: 5 }); }
  });
  it('reopens SQLite after a signed mapping request was lost, without issuing a new ticket', async () => {
    const root = mkdtempSync(join(tmpdir(), 'room-mapping-replay-'));
    let store = new RoomWorkspaceLocalStore(join(root, 'local.db'));
    const calls: string[] = [];
    const record = { recordKey: 'op', roomId: 'r', projectId: 'p', operationId: 'op', payloadDigest: 'digest', payload: { workspaceId: 'w', bindingId: 'b', generation: 1, expectedProjectRevision: 2 }, applied: false };
    store.saveRecord('pending-mapping', record.recordKey, record);
    store.close(); store = new RoomWorkspaceLocalStore(join(root, 'local.db'));
    const recovery = createRoomWorkspaceMappingRecovery({ store, isMutationOwner: () => true, broker: { request: async (_room, action) => { calls.push(action); return { ok: true, ticket: { ticketId: 'ticket', roomId: 'r', projectId: 'p', operationId: 'op', payloadDigest: 'digest', workspaceId: 'w', bindingId: 'b', generation: 1, expectedProjectRevision: 2 } }; } }, kswarmRequest: async (_path, init) => { calls.push('apply'); expect(JSON.parse(String(init?.body)).ticketId).toBe('ticket'); return { ok: true, json: async () => ({ ok: true }) }; } });
    try {
      expect(await recovery.recover()).toEqual(['r']);
      expect(await recovery.recover()).toEqual([]);
      expect(calls).toEqual(['recover-mapping-ticket', 'apply']);
      expect(store.getRecord<any>('pending-mapping', 'op').applied).toBe(true);
    } finally { store.close(); rmSync(root, { recursive: true, force: true, maxRetries: 5 }); }
  });
  it('refuses a mismatched historical ticket and leaves bytes and journal pending', async () => {
    const root = mkdtempSync(join(tmpdir(), 'room-mapping-deny-'));
    const store = new RoomWorkspaceLocalStore(join(root, 'local.db'));
    store.saveRecord('pending-mapping', 'op', { recordKey: 'op', roomId: 'r', projectId: 'p', operationId: 'op', payloadDigest: 'expected', payload: {}, applied: false });
    let writes = 0;
    try {
      const recovery = createRoomWorkspaceMappingRecovery({ store, isMutationOwner: () => true, broker: { request: async () => ({ ok: true, ticket: { payloadDigest: 'other' } }) }, kswarmRequest: async () => { writes++; throw new Error('must not apply'); } });
      expect(await recovery.recover()).toEqual([]); expect(writes).toBe(0);
      expect(store.getRecord<any>('pending-mapping', 'op').applied).toBe(false);
    } finally { store.close(); rmSync(root, { recursive: true, force: true, maxRetries: 5 }); }
  });
  it('cancels only an exact unsigned fence instead of creating new background authority', async () => {
    const root = mkdtempSync(join(tmpdir(), 'room-mapping-unsigned-'));
    const store = new RoomWorkspaceLocalStore(join(root, 'local.db'));
    const record = { recordKey: 'op', roomId: 'r', projectId: 'p', operationId: 'op', payloadDigest: 'digest', payload: { bindingId: 'b', generation: 1 }, applied: false };
    store.saveRecord('pending-mapping', 'op', record);
    const calls: string[] = [];
    try {
      const recovery = createRoomWorkspaceMappingRecovery({ store, isMutationOwner: () => true, broker: { request: async (_room, action) => { calls.push(action); if (action === 'recover-mapping-ticket') return { ok: false, code: 'workspace_ticket_mismatch' }; if (action === 'recover-mapping-operation') return { ok: true, mapping: { roomId: 'r', projectId: 'p', operationId: 'op', bindingId: 'b', generation: 1, state: 'updating' } }; return { ok: action === 'cancel-mapping' }; } }, kswarmRequest: async () => { throw new Error('must not apply'); } });
      expect(await recovery.recover()).toEqual(['r']);
      expect(store.getRecord<any>('pending-mapping', 'op').cancelled).toBe(true);
      expect(calls).toEqual(['recover-mapping-ticket', 'recover-mapping-operation', 'cancel-mapping']);
    } finally { store.close(); rmSync(root, { recursive: true, force: true, maxRetries: 5 }); }
  });
  it('settles a previously saved ticket as rejected when authority rejected its mapping', async () => {
    const root = mkdtempSync(join(tmpdir(), 'room-mapping-rejected-'));
    const store = new RoomWorkspaceLocalStore(join(root, 'local.db'));
    const record = { recordKey: 'op', roomId: 'r', projectId: 'p', operationId: 'op', payloadDigest: 'digest', ticketId: 't', payload: { workspaceId: 'w', bindingId: 'b', generation: 1, expectedProjectRevision: 2 }, applied: false };
    store.saveRecord('pending-mapping', 'op', record);
    let applied = 0;
    try {
      const recovery = createRoomWorkspaceMappingRecovery({ store, isMutationOwner: () => true, broker: { request: async () => ({ ok: true, ticket: { ...record.payload, roomId: 'r', projectId: 'p', operationId: 'op', payloadDigest: 'digest', ticketId: 't', rejected: true } }) }, kswarmRequest: async () => { applied++; throw new Error('already rejected'); } });
      expect(await recovery.recover()).toEqual(['r']);
      expect(applied).toBe(0); expect(store.getRecord<any>('pending-mapping', 'op').rejected).toBe(true);
    } finally { store.close(); rmSync(root, { recursive: true, force: true, maxRetries: 5 }); }
  });
});
