// @vitest-environment node
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { RoomWorkspaceLocalStore } from '../../electron/room-workspace-local.js';
import { createRoomWorkspaceService } from '../../electron/room-workspace-service.js';
import { createRoomWorkspaceBrokerClient } from '../../electron/room-workspace-broker-client.js';

describe('R3 actual broker HTTP + Desktop SQLite + user filesystem', () => {
  it('binds arbitrary root, publishes rules, lists, registers, confirms and recovers exactly once', async () => {
    const sibling = resolve(process.cwd(), '..', '..', 'intent-broker');
    // Load sibling Node service natively, outside Vite's renderer import graph.
    const nodeImport = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<any>;
    const { createBrokerService } = await nodeImport(pathToFileURL(join(sibling, 'src', 'broker', 'service.js')).href);
    const { createServer } = await nodeImport(pathToFileURL(join(sibling, 'src', 'http', 'server.js')).href);
    const root = mkdtempSync(join(tmpdir(), 'room-workspace-http-')); const selected = join(root, '大家 工作'); mkdirSync(selected);
    const broker = createBrokerService({ dbPath: join(root, 'broker.db') });
    const server = createServer({ broker, roomService: broker.room, roomDesktopToken: 'fixture-secret', roomKSwarmToken: 'fixture-kswarm' });
    const store = new RoomWorkspaceLocalStore(join(root, 'local.db'));
    await server.listen(0, '127.0.0.1');
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    try {
      const created = await fetch(`${baseUrl}/rooms`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-intent-broker-room-token': 'fixture-secret' }, body: JSON.stringify({ title: 'Shared room', memberAgentIds: ['a', 'b'] }) }).then(response => response.json());
      const roomId = created.room.roomId;
      const client = createRoomWorkspaceBrokerClient({ token: 'fixture-secret', baseUrl, isMutationOwner: () => true });
      const request = client.request.bind(client);
      let projectionOffline = false;
      client.request = async (room, action, payload) => {
        if (action === 'projection' && projectionOffline) return { ok: false, code: 'broker_unavailable' };
        if (action === 'activate-binding') {
          const beforeActivation = await client.get(room);
          expect(beforeActivation.instructions?.publishedText).toBe('所有产物由管理者定义目录。');
        }
        return request(room, action, payload);
      };
      let service = createRoomWorkspaceService({ store, broker: client, isMutationOwner: () => true, ensureProtocol: async () => {} });
      const preview = await service.previewCollaborationRoomWorkspace({ roomId, mode: 'existing', selectedPath: selected, expectedRevision: 0, templateEntries: [], instructionsText: '所有产物由管理者定义目录。' });
      expect(preview.ok, JSON.stringify(preview)).toBe(true);
      const input = { roomId, previewId: preview.previewId!, expectedRevision: 0, idempotencyKey: 'bind1', confirmOverlap: true, confirmSharedReadGrant: true };
      const bound = await service.commitCollaborationRoomWorkspace(input);
      expect(bound.ok, JSON.stringify(bound)).toBe(true);
      expect(bound.snapshot?.rootDisplayPath).toContain('大家 工作');
      expect(bound.snapshot?.instructions?.publishedText).toBe('所有产物由管理者定义目录。');
      expect(readdirSync(selected)).toEqual([]);
      // Same user operation survives a new main-service instance; no new root
      // generation or template writes are introduced by replay.
      service = createRoomWorkspaceService({ store, broker: client, isMutationOwner: () => true, ensureProtocol: async () => {} });
      const replay = await service.commitCollaborationRoomWorkspace(input);
      expect(replay.ok, JSON.stringify(replay)).toBe(true);
      expect(replay.snapshot?.generation).toBe(bound.snapshot?.generation);
      writeFileSync(join(selected, '实际输出.md'), '# actual bytes');
      const file = { roomId, bindingId: bound.snapshot!.bindingId!, generation: bound.snapshot!.generation!, relativePath: '实际输出.md' };
      expect((await service.previewCollaborationRoomWorkspaceFile(file)).text).toBe('# actual bytes');
      projectionOffline = true;
      const registered = await service.registerCollaborationRoomWorkspaceArtifact({ ...file, expectedRevision: bound.snapshot!.revision, idempotencyKey: 'register1' });
      expect(registered.ok, JSON.stringify(registered)).toBe(true);
      expect(registered.snapshot?.artifacts).toHaveLength(1);
      expect(store.pendingOutbox()).toHaveLength(1);
      expect(registered.snapshot?.artifacts[0].synchronization).toBe('pending');
      projectionOffline = false;
      await service.flushOutbox();
      expect(store.pendingOutbox()).toHaveLength(0);
      expect((await service.getCollaborationRoomWorkspace({ roomId })).artifacts[0].synchronization).toBe('synced');
      const artifact = registered.snapshot!.artifacts[0];
      const confirmed = await service.confirmCollaborationRoomWorkspaceArtifact({ roomId, artifactId: artifact.artifactId, versionId: artifact.versionId, expectedRevision: registered.snapshot!.revision, idempotencyKey: 'confirm1' });
      expect(confirmed.ok, JSON.stringify(confirmed)).toBe(true);
      service = createRoomWorkspaceService({ store, broker: client, isMutationOwner: () => true, ensureProtocol: async () => {} });
      expect((await service.getCollaborationRoomWorkspace({ roomId })).artifacts[0].state).toBe('confirmed');
      writeFileSync(join(selected, '实际输出.md'), 'changed');
      expect((await service.previewCollaborationRoomWorkspaceFile({ ...file, versionId: artifact.versionId })).state).toBe('changed');
      expect((await service.getCollaborationRoomWorkspace({ roomId })).artifacts[0].state).toBe('changed');
      expect((await service.confirmCollaborationRoomWorkspaceArtifact({ roomId, artifactId: artifact.artifactId, versionId: artifact.versionId, expectedRevision: confirmed.snapshot!.revision, idempotencyKey: 'confirm-changed' })).ok).toBe(false);
      expect(readFileSync(join(selected, '实际输出.md'), 'utf8')).toBe('changed');
      // Crash between mkdir and the durable binding cannot silently adopt a
      // directory on retry. The owner can cancel draining, preserving bytes.
      const beforeChange = await service.getCollaborationRoomWorkspace({ roomId });
      const next = await service.previewCollaborationRoomWorkspace({ roomId, mode: 'create', selectedPath: selected, directoryName: 'created-before-crash', expectedRevision: beforeChange.revision, templateEntries: [] });
      const change = { roomId, previewId: next.previewId!, expectedRevision: beforeChange.revision, idempotencyKey: 'crash-bind', confirmOverlap: true, confirmSharedReadGrant: true };
      const prepare = vi.spyOn(store, 'prepareBinding').mockImplementationOnce(() => { throw new Error('simulated_process_loss'); });
      expect((await service.commitCollaborationRoomWorkspace(change)).ok).toBe(false);
      prepare.mockRestore();
      writeFileSync(join(selected, 'created-before-crash', 'preserve.txt'), 'user intervened');
      service = createRoomWorkspaceService({ store, broker: client, isMutationOwner: () => true, ensureProtocol: async () => {} });
      expect((await service.commitCollaborationRoomWorkspace(change)).ok).toBe(false);
      const pending = await service.getCollaborationRoomWorkspace({ roomId });
      expect(pending.phase).toBe('draining');
      expect((await service.cancelCollaborationRoomWorkspaceChange({ roomId, operationId: pending.operationId!, expectedRevision: pending.revision, idempotencyKey: 'cancel-crash' })).ok).toBe(true);
      expect(readFileSync(join(selected, 'created-before-crash', 'preserve.txt'), 'utf8')).toBe('user intervened');
      const published = await service.publishCollaborationRoomWorkspaceInstructions({ roomId, expectedRevision: (await service.getCollaborationRoomWorkspace({ roomId })).revision, idempotencyKey: 'direct-publish', publishedText: 'Directly entered room instructions' });
      expect(published.ok, JSON.stringify(published)).toBe(true);
      expect(published.snapshot?.instructions?.publishedText).toBe('Directly entered room instructions');
      expect(published.snapshot?.instructions?.revision).toBe(2);
      service = createRoomWorkspaceService({ store, broker: client, isMutationOwner: () => true, ensureProtocol: async () => {} });
      expect((await service.getCollaborationRoomWorkspace({ roomId })).instructions?.publishedText).toBe('Directly entered room instructions');
    } finally { await server.close(); broker.close(); store.close(); rmSync(root, { recursive: true, force: true, maxRetries: 5 }); }
  });
});
