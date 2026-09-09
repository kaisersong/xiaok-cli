// @vitest-environment node
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { describe, expect, it } from 'vitest';
import { RoomWorkspaceLocalStore, workspaceDigest } from '../../electron/room-workspace-local.js';
import { createRoomWorkspaceService } from '../../electron/room-workspace-service.js';
import { createRoomWorkspaceBrokerClient } from '../../electron/room-workspace-broker-client.js';
import { createRoomWorkspaceRecovery } from '../../electron/room-workspace-recovery.js';
import { createRoomWorkspaceRuntime } from '../../electron/room-workspace-runtime.js';

async function fixture() {
  const nativeImport = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<any>;
  const sibling = resolve(process.cwd(), '..', '..', 'intent-broker');
  const { createBrokerService } = await nativeImport(pathToFileURL(join(sibling, 'src/broker/service.js')).href);
  const { createServer } = await nativeImport(pathToFileURL(join(sibling, 'src/http/server.js')).href);
  const root = mkdtempSync(join(tmpdir(), 'room-recovery-')); const selected = join(root, 'user-files'); mkdirSync(selected);
  const broker = createBrokerService({ dbPath: join(root, 'broker.db') });
  const server = createServer({ broker, roomService: broker.room, roomDesktopToken: 'recovery-secret' });
  await server.listen(0, '127.0.0.1');
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const created = await fetch(`${baseUrl}/rooms`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-intent-broker-room-token': 'recovery-secret' }, body: JSON.stringify({ title: 'Recovery', memberAgentIds: ['a'] }) }).then(r => r.json());
  const roomId = created.room.roomId as string;
  let store = new RoomWorkspaceLocalStore(join(root, 'local.db'));
  const newClient = () => createRoomWorkspaceBrokerClient({ token: 'recovery-secret', baseUrl, isMutationOwner: () => true });
  const client = newClient();
  const service = createRoomWorkspaceService({ store, broker: client, isMutationOwner: () => true, ensureProtocol: async () => {} });
  const preview = await service.previewCollaborationRoomWorkspace({ roomId, mode: 'existing', selectedPath: selected, expectedRevision: 0, templateEntries: [], instructionsText: '' });
  const bound = await service.commitCollaborationRoomWorkspace({ roomId, previewId: preview.previewId!, expectedRevision: 0, idempotencyKey: 'bind', confirmOverlap: true, confirmSharedReadGrant: true });
  expect(bound.ok, JSON.stringify(bound)).toBe(true);
  writeFileSync(join(selected, 'keep.txt'), 'user bytes');
  async function acquire(id = 'run') {
    const response = await client.request(roomId, 'acquire', { logicalAgentId: 'a', runId: id, executorInstanceId: `executor-${id}`, contextScope: { kind: 'room_only' }, capability: { contextVersion: 1, resultVersion: 1, releaseVersion: 1, canSetCwd: true, canTrackChildren: true, canRelease: true } });
    expect(response.ok, JSON.stringify(response)).toBe(true);
    const claim = response.claim as Record<string, any>;
    expect((await client.request(roomId, 'ack', { ...claim, actualCwd: selected, cwdVerified: true })).ok).toBe(true);
    return claim;
  }
  function reopen() { store.close(); store = new RoomWorkspaceLocalStore(join(root, 'local.db')); return store; }
  function pending(claim: Record<string, any>, ownerPid = process.pid, proof = true) {
    store.saveRecord('physical-claim', claim.claimId, { claim, ownerPid, kind: 'in-process-tracked', released: false, ...(proof ? { releasePending: { executorInstanceId: claim.executorInstanceId, kind: 'resources-disposed', verified: true } } : {}) });
  }
  return { roomId, client, newClient, acquire, pending, reopen, get store() { return store; }, selected,
    async close() { expect(readFileSync(join(selected, 'keep.txt'), 'utf8')).toBe('user bytes'); await server.close(); broker.close(); store.close(); rmSync(root, { recursive: true, force: true, maxRetries: 5 }); } };
}

describe('workspace recovery: real broker authority + reopened SQLite', () => {
  it('unknown admission from a live old process stays blocked until positive process exit', async () => {
    const f=await fixture(),child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},stdio:'ignore'});
    try{
      await once(child,'spawn');
      const request={runId:'lost-process-run',executorInstanceId:'lost-process-executor',logicalAgentId:'a',contextScope:{kind:'room_only'},capability:{contextVersion:1,resultVersion:1,releaseVersion:1,canSetCwd:true,canTrackChildren:true,canRelease:true}};
      f.store.saveRecord('admission-request','lost-key',{requestKey:'lost-key',roomId:f.roomId,ownerPid:child.pid,state:'requesting',request});
      const issued=await f.client.request(f.roomId,'acquire',request);expect(issued.ok).toBe(true);
      f.reopen();const client=f.newClient(),recovery=createRoomWorkspaceRecovery({store:f.store,broker:client,isMutationOwner:()=>true,flushOutbox:async()=>{}});
      await recovery.recoverRoom(f.roomId);expect(f.store.listRecords('physical-claim')).toHaveLength(0);
      child.kill();await once(child,'exit');await recovery.recoverRoom(f.roomId);
      expect((await client.get(f.roomId)).claims).toEqual(expect.arrayContaining([expect.objectContaining({runId:request.runId,executionState:'released'})]));
      await recovery.stop();
    }finally{if(child.exitCode===null&&child.signalCode===null){child.kill();await once(child,'exit');}await f.close();}
  });
  it('recovers committed admission with lost ACK without reacquiring or executing after SQLite reopen', async () => {
    const f=await fixture();let acquired:Record<string,any>|undefined,executed=0;
    try {
      const runtime=createRoomWorkspaceRuntime({store:f.store,broker:{...f.client,async request(roomId,action,input){const result=await f.client.request(roomId,action,input);if(action==='acquire'){acquired=result.claim as Record<string,any>;throw new Error('lost acquire ACK');}return result;}},wake:{claimWake:async()=>({}),completeWake:async()=>({})},ensureProtocol:async()=>{},execute:async()=>{executed++;return{text:'must not run'};}});
      await expect(runtime.run({roomId:f.roomId,roomTitle:'r',roomRevision:1,roomMessageId:'lost-admission',logicalAgentId:'a',contextScope:{kind:'room_only'},messages:[],attachmentPaths:[],contextWindow:{fromSequence:0,toSequence:0,totalMessages:0,isComplete:true,snapshotAt:new Date().toISOString()}})).rejects.toThrow('lost acquire ACK');
      expect(acquired?.executionState).toBe('admitted');expect(f.store.listRecords('physical-claim')).toHaveLength(0);
      f.reopen();const client=f.newClient(),calls:string[]=[];
      const recovery=createRoomWorkspaceRecovery({store:f.store,broker:{...client,async request(roomId,action,input){calls.push(action);return client.request(roomId,action,input);}},isMutationOwner:()=>true,flushOutbox:async()=>{}});
      await recovery.recoverRoom(f.roomId);
      expect((await client.get(f.roomId)).claims).toEqual(expect.arrayContaining([expect.objectContaining({claimId:acquired!.claimId,executionState:'released'})]));
      expect(calls).toContain('recover-admission');expect(calls).not.toContain('acquire');expect(executed).toBe(0);
      await recovery.stop();await runtime.shutdown();
    }finally{await f.close();}
  });
  it('replays durable physical proof after release connection loss and host reincarnation exactly once', async () => {
    const f = await fixture();
    try {
      const claim = await f.acquire(); f.pending(claim); f.reopen();
      const client = f.newClient(); let releases = 0;
      const port = { ...client, async request(roomId: string, action: string, input: Record<string, unknown>) {
        const result = await client.request(roomId, action, input);
        if (action === 'release' && releases++ === 0) throw new Error('socket response lost');
        return result;
      } };
      const recovery = createRoomWorkspaceRecovery({ store: f.store, broker: port, isMutationOwner: () => true, flushOutbox: async () => {} });
      await recovery.recoverRoom(f.roomId);
      expect(f.store.getRecord<any>('physical-claim', claim.claimId).released).toBe(false);
      await recovery.recoverRoom(f.roomId);
      expect(f.store.getRecord<any>('physical-claim', claim.claimId).released).toBe(true);
      expect((await client.get(f.roomId)).claims).toEqual(expect.arrayContaining([expect.objectContaining({ claimId: claim.claimId, executionState: 'released', authorizationState: 'orphaned' })]));
      await recovery.stop();
    } finally { await f.close(); }
  });

  it('never releases an unknown live old PID or current-process never-settle without proof', async () => {
    const f = await fixture(); const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'ignore' });
    try {
      await once(child, 'spawn');
      const old = await f.acquire('old'); const current = await f.acquire('current');
      f.pending(old, child.pid!, true); f.pending(current, process.pid, false); f.reopen();
      const client = f.newClient();
      const recovery = createRoomWorkspaceRecovery({ store: f.store, broker: client, isMutationOwner: () => true, flushOutbox: async () => {} });
      await recovery.recoverRoom(f.roomId);
      expect((await client.get(f.roomId)).claims).toEqual(expect.arrayContaining([expect.objectContaining({ claimId: old.claimId, executionState: 'running' }), expect.objectContaining({ claimId: current.claimId, executionState: 'running' })]));
      child.kill(); await once(child, 'exit');
      await recovery.recoverRoom(f.roomId);
      expect(f.store.getRecord<any>('physical-claim', old.claimId).released).toBe(true);
      expect(f.store.getRecord<any>('physical-claim', current.claimId).released).toBe(false);
      await recovery.stop();
    } finally { if (child.exitCode === null && child.signalCode === null) { child.kill(); await once(child, 'exit'); } await f.close(); }
  });

  it.each([false, true])('cancel after ticket=%s: recover only historical authorization, never issue a new ticket', async (authorized) => {
    const f = await fixture();
    try {
      const claim = await f.acquire();
      const manifest = { roomId: f.roomId, workspaceId: claim.workspaceId, originHostId: claim.originHostId, bindingId: claim.bindingId, generation: claim.generation, contextScope: { kind: 'room_only' }, producerType: 'agent', producerClaimId: claim.claimId, artifacts: [{ relativePath: 'keep.txt', contentHash: 'recorded-hash' }] };
      const payloadDigest = workspaceDigest('manifest', manifest);
      f.store.prepareSubmission({ subjectKey: `claim:${claim.claimId}`, submissionId: claim.runId, payloadDigest, manifest });
      if (authorized) expect((await f.client.request(f.roomId, 'agent-ticket', { ...claim, submissionId: claim.runId, payloadDigest })).ok).toBe(true);
      expect((await f.client.request(f.roomId, 'cancel', { claimId: claim.claimId })).ok).toBe(true);
      f.reopen(); const client = f.newClient(); const calls: string[] = [];
      if (authorized) {
        const wrongKind = createRoomWorkspaceRecovery({ store: f.store, broker: { ...client, async request(roomId, action, input) { const result = await client.request(roomId, action, input); return action === 'recover-ticket' && result.ticket ? { ...result, ticket: { ...(result.ticket as Record<string, unknown>), allowedEventKinds: ['artifact.confirmed'] } } : result; } }, isMutationOwner: () => true, flushOutbox: async () => {} });
        await wrongKind.recoverRoom(f.roomId); await wrongKind.stop();
        expect(f.store.listArtifacts(f.roomId)).toEqual([]);
      }
      const port = { ...client, async request(roomId: string, action: string, input: Record<string, unknown>) { calls.push(action); return client.request(roomId, action, input); } };
      const recovery = createRoomWorkspaceRecovery({ store: f.store, broker: port, isMutationOwner: () => true, flushOutbox: async () => {
        for (const event of f.store.pendingOutbox()) { const ticket = event.ticket as Record<string, unknown>; const result = await client.request(f.roomId, 'projection', { ticketId: ticket.ticketId, payloadDigest: ticket.payloadDigest, eventKind: event.eventKind }); if (result.ok) f.store.acknowledgeOutbox(event.eventId); }
      } });
      await recovery.recoverRoom(f.roomId); await recovery.recoverRoom(f.roomId);
      expect(f.store.listArtifacts(f.roomId)).toHaveLength(authorized ? 1 : 0);
      expect(f.store.pendingOutbox()).toHaveLength(0);
      expect(calls).not.toContain('ticket'); expect(calls).not.toContain('agent-ticket');
      await recovery.stop();
    } finally { await f.close(); }
  });

  it('recovers a lost takeover reply after another SQLite reopen without a guessed incarnation', async () => {
    const f = await fixture();
    try {
      const claim = await f.acquire(); f.pending(claim); f.reopen();
      const client = f.newClient();
      const recovery = createRoomWorkspaceRecovery({ store: f.store, broker: { ...client, async request(roomId, action, input) { const result = await client.request(roomId, action, input); if (action === 'takeover') throw new Error('reply lost'); return result; } }, isMutationOwner: () => true, flushOutbox: async () => {} });
      await recovery.recoverRoom(f.roomId); await recovery.stop();
      expect(f.store.getRecord<any>('physical-claim', claim.claimId).released).toBe(false);
      f.reopen();
      const resumed = createRoomWorkspaceRecovery({ store: f.store, broker: f.newClient(), isMutationOwner: () => true, flushOutbox: async () => {} });
      await resumed.recoverRoom(f.roomId);
      expect(f.store.getRecord<any>('physical-claim', claim.claimId).released).toBe(true);
      await resumed.stop();
    } finally { await f.close(); }
  });

  it('singleflights recoverRoom and stop waits for the current RPC but sends no next mutation', async () => {
    const f = await fixture();
    try {
      const claim = await f.acquire(); f.pending(claim); f.reopen();
      const client = f.newClient(); const calls: string[] = [];
      let unblock!: () => void; const gate = new Promise<void>(resolve => { unblock = resolve; });
      let entered!: () => void; const entry = new Promise<void>(resolve => { entered = resolve; });
      const recovery = createRoomWorkspaceRecovery({ store: f.store, broker: { ...client, async request(roomId, action, input) { calls.push(action); const result = await client.request(roomId, action, input); entered(); await gate; return result; } }, isMutationOwner: () => true, flushOutbox: async () => {} });
      const a = recovery.recoverRoom(f.roomId); const b = recovery.recoverRoom(f.roomId); expect(a).toBe(b);
      await entry; let stopped = false; const stopping = recovery.stop().then(() => { stopped = true; });
      await Promise.resolve(); expect(stopped).toBe(false); unblock(); await stopping; await a;
      expect(calls).toEqual(['takeover']);
      expect(f.store.getRecord<any>('physical-claim', claim.claimId).released).toBe(false);
      await recovery.recoverRoom(f.roomId); expect(calls).toEqual(['takeover']);
    } finally { await f.close(); }
  });

  it('default-denies a non-owner before broker registration or local mutation', async () => {
    const f = await fixture();
    try {
      const claim = await f.acquire(); f.pending(claim); f.reopen(); let calls = 0;
      const recovery = createRoomWorkspaceRecovery({ store: f.store, broker: { async get() { calls++; throw new Error('unexpected'); }, async request() { calls++; throw new Error('unexpected'); }, async getHost() { calls++; throw new Error('unexpected'); } }, isMutationOwner: () => false, flushOutbox: async () => { calls++; } });
      await recovery.recoverRoom(f.roomId); recovery.start(); recovery.start(); await recovery.stop();
      expect(calls).toBe(0); expect(f.store.getRecord<any>('physical-claim', claim.claimId).released).toBe(false);
    } finally { await f.close(); }
  });

  it('start retries a committed outbox-only record after SQLite reopen with one owner', async () => {
    const f = await fixture();
    try {
      const claim = await f.acquire();
      const manifest = { roomId: f.roomId, workspaceId: claim.workspaceId, bindingId: claim.bindingId, generation: claim.generation, contextScope: { kind: 'room_only' }, producerType: 'agent', producerClaimId: claim.claimId, artifacts: [{ relativePath: 'keep.txt' }] };
      const payloadDigest = workspaceDigest('manifest', manifest);
      f.store.prepareSubmission({ subjectKey: `claim:${claim.claimId}`, submissionId: claim.runId, payloadDigest, manifest });
      const issued = await f.client.request(f.roomId, 'agent-ticket', { ...claim, submissionId: claim.runId, payloadDigest });
      expect(issued.ok).toBe(true);
      f.store.commitSubmission(`claim:${claim.claimId}`, issued.ticket as any); f.reopen();
      expect(f.store.listPendingSubmissions()).toHaveLength(0); expect(f.store.pendingOutbox()).toHaveLength(1);
      const client = f.newClient(); const service = createRoomWorkspaceService({ store: f.store, broker: client, isMutationOwner: () => true, ensureProtocol: async () => {} });
      let resolveFlush!: () => void; const flushed = new Promise<void>(resolve => { resolveFlush = resolve; }); let count = 0;
      const recovery = createRoomWorkspaceRecovery({ store: f.store, broker: client, isMutationOwner: () => true, flushOutbox: async () => { count++; await service.flushOutbox(); resolveFlush(); } });
      recovery.start(); recovery.start(); await flushed; await recovery.stop();
      expect(f.store.pendingOutbox()).toHaveLength(0); expect(count).toBe(1);
    } finally { await f.close(); }
  });

  it('uses the same recovery owner to drain additional project journals and waits on stop', async () => {
    const f = await fixture();
    let unblock!: () => void;
    const gate = new Promise<void>(resolve => { unblock = resolve; });
    let calls = 0;
    const recovery = createRoomWorkspaceRecovery({ store: f.store, broker: f.client, isMutationOwner: () => true, flushOutbox: async () => {}, recoverAdditional: async () => { calls++; await gate; } });
    try {
      recovery.start(); recovery.start();
      await Promise.resolve();
      expect(calls).toBe(1);
      let stopped = false; const stopping = recovery.stop().then(() => { stopped = true; });
      await Promise.resolve(); expect(stopped).toBe(false);
      unblock(); await stopping; recovery.start(); expect(calls).toBe(1);
    } finally { unblock(); await recovery.stop(); await f.close(); }
  });
  it('recovers a confirmation ticket lost after authorization without creating another confirmation', async () => {
    const f = await fixture();
    try {
      const service = createRoomWorkspaceService({ store: f.store, broker: { ...f.client, async request(roomId, action, input) { const response = await f.client.request(roomId, action, input); if (action === 'confirm-artifact') throw new Error('confirmation response lost'); return response; } }, isMutationOwner: () => true, ensureProtocol: async () => {} });
      const snapshot = await service.getCollaborationRoomWorkspace({ roomId: f.roomId });
      const registered = await service.registerCollaborationRoomWorkspaceArtifact({ roomId: f.roomId, bindingId: snapshot.bindingId!, generation: snapshot.generation!, relativePath: 'keep.txt', expectedRevision: snapshot.revision, idempotencyKey: 'user-register' });
      expect(registered.ok, JSON.stringify(registered)).toBe(true);
      const artifact = registered.snapshot!.artifacts[0];
      const failed = await service.confirmCollaborationRoomWorkspaceArtifact({ roomId: f.roomId, artifactId: artifact.artifactId, versionId: artifact.versionId, expectedRevision: registered.snapshot!.revision, idempotencyKey: 'confirm-lost' });
      expect(failed.ok).toBe(false); expect(f.store.listArtifacts(f.roomId)[0].state).toBe('draft'); f.reopen();
      const client = f.newClient(); const calls: string[] = [];
      const recoveredService = createRoomWorkspaceService({ store: f.store, broker: client, isMutationOwner: () => true, ensureProtocol: async () => {} });
      const recovery = createRoomWorkspaceRecovery({ store: f.store, broker: { ...client, async request(roomId, action, input) { calls.push(action); return client.request(roomId, action, input); } }, isMutationOwner: () => true, flushOutbox: recoveredService.flushOutbox });
      await recovery.recoverRoom(f.roomId); await recovery.recoverRoom(f.roomId);
      expect(f.store.listArtifacts(f.roomId)[0].state).toBe('confirmed'); expect(f.store.pendingOutbox()).toHaveLength(0);
      expect(calls).not.toContain('confirm-artifact'); expect(calls).toEqual(['recover-ticket']);
      await recovery.stop();
    } finally { await f.close(); }
  });
});
