// @vitest-environment node
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { expect, it, vi } from 'vitest';
import { createRoomProjectScopeGuard } from '../../electron/room-project-scope-guard.js';
import { createCollaborationRoomBrokerClient } from '../../electron/collaboration-room-broker-client.js';
import { createRoomWorkspaceBrokerClient } from '../../electron/room-workspace-broker-client.js';

it('real Broker HTTP + real KSwarm process enforce project discussion scope and disconnect refusal', async () => {
  const nativeImport = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<any>;
  const siblings = resolve(process.cwd(), '../..');
  const { createBrokerService } = await nativeImport(pathToFileURL(join(siblings, 'intent-broker/src/broker/service.js')).href);
  const { createServer: createBrokerServer } = await nativeImport(pathToFileURL(join(siblings, 'intent-broker/src/http/server.js')).href);
  const { createHub } = await nativeImport(pathToFileURL(join(siblings, 'kswarm/src/core/hub.js')).href);
  const root = mkdtempSync(join(tmpdir(), 'room-project-http-')); const kroot = join(root, 'kswarm'); mkdirSync(kroot);
  const broker = createBrokerService({ dbPath: join(root, 'broker.db') });
  const server = createBrokerServer({ broker, roomService: broker.room, roomDesktopToken: 'scope-desktop', roomKSwarmToken: 'scope-service' });
  await server.listen(0, '127.0.0.1'); const brokerUrl = `http://127.0.0.1:${server.address().port}`;
  const roomClient = createCollaborationRoomBrokerClient({ token: 'scope-desktop', fetchImpl: (input, init) => fetch(`${brokerUrl}${new URL(String(input)).pathname}${new URL(String(input)).search}`, init) });
  const created = await roomClient.createRoom({ title: 'Scope HTTP', memberAgentIds: ['a', 'outsider'] }); const roomId = (created.room as any).roomId;
  const seed = createHub({ silent: true, dataDir: { backend: 'sqlite', filePath: join(kroot, 'state.sqlite'), silent: true } });
  const p = seed.createProject({ id: 'p', name: 'p', goal: 'g', poAgent: 'po', members: ['a'], autoAssignPo: false }); p.primaryRoomId = roomId; seed.persistState(); seed.closePersistence();
  const reservation = createServer(); reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening'); const port = (reservation.address() as { port: number }).port; await new Promise<void>(done => reservation.close(() => done()));
  const child = spawn(process.execPath, [join(siblings, 'kswarm/src/server/index.js')], { cwd: join(siblings, 'kswarm'), env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', KSWARM_PORT: String(port), KSWARM_DATA_ROOT: kroot, KSWARM_DESKTOP_MUTATION_TOKEN: 'scope-main', BROKER_URL: brokerUrl }, stdio: ['ignore', 'pipe', 'pipe'] });
  let childLog = ''; child.stdout.on('data', chunk => { childLog += chunk; }); child.stderr.on('data', chunk => { childLog += chunk; });
  const exited = once(child, 'exit'); const kurl = `http://127.0.0.1:${port}`;
  try {
    await vi.waitFor(async () => { expect((await fetch(`${kurl}/health`)).ok, childLog).toBe(true); }, { timeout: 10000, interval: 100 });
    expect((await fetch(`${kurl}/projects/p/workspace-mapping?logicalAgentId=a`)).status).toBe(401);
    const workspaceBroker = createRoomWorkspaceBrokerClient({ token: 'scope-desktop', baseUrl: brokerUrl, isMutationOwner: () => true });
    const guard = createRoomProjectScopeGuard({ roomClient, workspaceBroker, kswarmRequest: (path, init) => fetch(`${kurl}${path}`, { ...init, headers: { 'x-kswarm-mutation-token': 'scope-main' } }) });
    await roomClient.sendRoomMessage({ roomId, text: 'OTHER_PROJECT_PRIVATE', contextScope: { kind: 'project', projectId: 'other' }, responsePolicy: 'none', idempotencyKey: 'other' });
    const sent = await roomClient.sendRoomMessage({ roomId, text: 'project discussion', contextScope: { kind: 'project', projectId: 'p' }, responsePolicy: 'mentioned', mentions: [{ kind: 'agent', logicalAgentId: 'a' }, { kind: 'agent', logicalAgentId: 'outsider' }], idempotencyKey: 'source' });
    const roomMessageId = (sent.message as any).messageId;
    expect((await guard.workspaceBroker.request(roomId, 'claim-wake', { roomMessageId, logicalAgentId: 'outsider', discussionOnly: true })).ok).toBe(false);
    const wake = await guard.workspaceBroker.request(roomId, 'claim-wake', { roomMessageId, logicalAgentId: 'a', discussionOnly: true }); expect(wake.ok, JSON.stringify(wake)).toBe(true);
    const page = await guard.roomClient.listRoomMessagesPage({ roomId, claimToken: String(wake.claimToken) });
    expect(page.ok).toBe(true); expect(JSON.stringify(page)).not.toContain('OTHER_PROJECT_PRIVATE'); expect(page.totalMessages).toBe(1);
    expect((await guard.roomClient.completeWake({ roomId, claimToken: wake.claimToken, reply: { kind: 'text', text: 'project reply', contextScope: { kind: 'room_only' } } })).ok).toBe(true);
    const snapshot = await roomClient.getRoomSnapshot(roomId); expect((snapshot.messages as any[]).find(m => m.text === 'project reply').contextScope).toEqual({ kind: 'project', projectId: 'p' });
    const next = await roomClient.sendRoomMessage({ roomId, text: 'next discussion', contextScope: { kind: 'project', projectId: 'p' }, responsePolicy: 'mentioned', mentions: [{ kind: 'agent', logicalAgentId: 'a' }], idempotencyKey: 'next' });
    const second = await guard.workspaceBroker.request(roomId, 'claim-wake', { roomMessageId: (next.message as any).messageId, logicalAgentId: 'a', discussionOnly: true }); expect(second.ok).toBe(true);
    child.kill('SIGTERM'); await exited;
    expect((await guard.roomClient.completeWake({ roomId, claimToken: second.claimToken, reply: { kind: 'text', text: 'MUST_NOT_PUBLISH' } })).ok).toBe(false);
    expect(JSON.stringify(await roomClient.getRoomSnapshot(roomId))).not.toContain('MUST_NOT_PUBLISH');
    const abandoned = await guard.roomClient.abandonWake({ roomId, claimToken: String(second.claimToken), reason: 'execution_failed' });
    expect(abandoned.ok, JSON.stringify(abandoned)).toBe(true); expect(abandoned.wakeStatus).toBe('failed');
    expect((await guard.roomClient.abandonWake({ roomId, claimToken: String(second.claimToken) })).ok).toBe(true);
    const recovered = await workspaceBroker.request(roomId, 'recover-wake', { claimToken: second.claimToken });
    expect(recovered).toEqual({ ok: true, wake: { roomId, roomMessageId: (next.message as any).messageId, logicalAgentId: 'a', contextScope: { kind: 'project', projectId: 'p' }, wakeStatus: 'failed' } });
    expect((await workspaceBroker.get(roomId)).claims).toEqual([]);
  } finally {
    if (child.exitCode === null && child.signalCode === null) { child.kill('SIGTERM'); await exited; }
    await server.close(); broker.close(); rmSync(root, { recursive: true, force: true, maxRetries: 5 });
  }
}, 20000);
