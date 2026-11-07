// @vitest-environment node
import { afterAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const isolatedConfig = await vi.hoisted(async () => {
  const fs = await import('node:fs'),
    os = await import('node:os'),
    path = await import('node:path');
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'scoped-room-module-config-'),
  );
  const prior = process.env.XIAOK_CONFIG_DIR;
  process.env.XIAOK_CONFIG_DIR = path.join(root, 'config');
  const nativeFetch = globalThis.fetch,
    ports = new Map<string, number>();
  // Fixed test-only routing is installed before the first business import.
  // No production URL, transport identity gate or user listener is changed.
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (
      (url.hostname === '127.0.0.1' || url.hostname === 'localhost') &&
      (url.port === '4318' || url.port === '4400')
    ) {
      const port = ports.get(url.port);
      if (port === undefined) throw Error('SCOPED_FIXTURE_ENDPOINT_NOT_READY');
      url.hostname = '127.0.0.1';
      url.port = String(port);
      return nativeFetch(url, init);
    }
    return nativeFetch(input, init);
  }) as typeof fetch;
  return { root, prior, ports, nativeFetch };
});
afterAll(() => {
  if (isolatedConfig.prior === undefined) delete process.env.XIAOK_CONFIG_DIR;
  else process.env.XIAOK_CONFIG_DIR = isolatedConfig.prior;
  globalThis.fetch = isolatedConfig.nativeFetch;
  rmSync(isolatedConfig.root, { recursive: true, force: true });
});
vi.mock('electron', () => ({ app: { isReady: () => false } }));
import * as dispatcherModule from '../../electron/collaboration-room-wake-dispatcher.js';
import * as scopeModule from '../../electron/room-project-scope-guard.js';
import * as workspaceModule from '../../electron/room-workspace-broker-client.js';
import * as serviceModule from '../../electron/kswarm-service.js';
function exported(module: object, name: string): unknown {
  // These are fixed, test-owned ESM import namespaces, not authority handles.
  return Reflect.get(module, name);
}
describe('original Main scoped Room source boundary', () => {
  it('exports the original dispatcher bind and private scoped facet without generic registration', () => {
    expect(exported(scopeModule, 'createRoomProjectScopeGuard')).toBeTypeOf(
      'function',
    );
    expect(
      exported(dispatcherModule, 'bindOriginalScopedRoomWakeDispatcher'),
    ).toBeTypeOf('function');
    expect(
      exported(scopeModule, 'readOptionalOriginalScopedRoomWakeAcceptance'),
    ).toBeTypeOf('function');
    expect(
      exported(workspaceModule, 'claimOriginalRoomWorkspaceDiscussion'),
    ).toBeTypeOf('function');
    expect(
      exported(serviceModule, 'readOriginalKSwarmRoomProjectMappingIO'),
    ).toBeTypeOf('function');
  });
});

it('qualified workspace claim and negative abandon never consult replaceable public transports', async () => {
  const root = mkdtempSync(join(tmpdir(), 'scoped-original-room-'));
  const oldConfig = process.env.XIAOK_CONFIG_DIR;
  process.env.XIAOK_CONFIG_DIR = join(root, 'config');
  const nativeImport = (specifier: string) =>
    import(/* @vite-ignore */ specifier);
  const siblings = resolve(process.cwd(), '../..');
  const { createBrokerService } = await nativeImport(
    pathToFileURL(join(siblings, 'intent-broker/src/broker/service.js')).href,
  );
  const { createServer } = await nativeImport(
    pathToFileURL(join(siblings, 'intent-broker/src/http/server.js')).href,
  );
  const service = serviceModule.createKSwarmService();
  const token = service.getIntentBrokerRoomToken();
  const broker = createBrokerService({ dbPath: join(root, 'broker.sqlite') });
  const server = createServer({
    broker,
    roomService: broker.room,
    roomDesktopToken: token,
  });
  await server.listen(0, '127.0.0.1');
  isolatedConfig.ports.set('4318', server.address().port);
  try {
    const rawModule = await import(
      '../../electron/collaboration-room-broker-client.js'
    );
    const client = rawModule.createCollaborationRoomBrokerClient({ token });
    const workspace = workspaceModule.createRoomWorkspaceBrokerClient({
      token,
      isMutationOwner: () => true,
    });
    const caller = vi.fn(async () => {
      throw Error('caller transport must be ignored');
    });
    const guard = scopeModule.createRoomProjectScopeGuard({
      roomClient: client,
      workspaceBroker: workspace,
      kswarmRequest: caller,
    });
    expect(
      scopeModule.bindOriginalRoomProjectScopeGuardClient(
        guard.roomClient,
        service,
      ),
    ).toBe(true);
    const created = await client.createRoom({
      title: 'private scoped',
      memberAgentIds: ['a'],
    });
    const roomId = (created.room as any).roomId;
    const message = await client.sendRoomMessage({
      roomId,
      text: 'room-only',
      contextScope: { kind: 'room_only' },
      responsePolicy: 'mentioned',
      mentions: [{ kind: 'agent', logicalAgentId: 'a' }],
      idempotencyKey: 'private-source',
    });
    const roomMessageId = (message.message as any).messageId;
    const legacyWorkspace = workspaceModule.createRoomWorkspaceBrokerClient({
      token,
      isMutationOwner: () => true,
    });
    await legacyWorkspace.getHost(roomId);
    expect(() =>
      workspaceModule.bindOriginalRoomWorkspaceDiscussionClient(
        legacyWorkspace,
        service,
      ),
    ).toThrow('ROOM_SCOPED_WORKSPACE_LEGACY_REGISTRATION_STARTED');
    let publicGetters = 0;
    for (const name of [
      'getRoomSnapshot',
      'completeWake',
      'listRoomMessagesPage',
    ])
      Object.defineProperty(client, name, {
        get() {
          publicGetters++;
          throw Error('public getter');
        },
        configurable: true,
      });
    const replaced = vi.fn(async () => {
      throw Error('public workspace replaced');
    });
    workspace.request = replaced;
    const claim = await guard.workspaceBroker.request(roomId, 'claim-wake', {
      roomMessageId,
      logicalAgentId: 'a',
      hostParticipantId: 'xiaok-desktop',
      discussionOnly: true,
    });
    expect(claim.ok, JSON.stringify(claim)).toBe(true);
    expect(
      (
        await guard.roomClient.listRoomMessagesPage({
          roomId,
          claimToken: String(claim.claimToken),
        })
      ).ok,
    ).toBe(true);
    expect(
      (
        await guard.roomClient.completeWake({
          roomId,
          claimToken: String(claim.claimToken),
          reply: { kind: 'pass' },
        })
      ).ok,
    ).toBe(true);
    const secondMessage = await client.sendRoomMessage({
      roomId,
      text: 'second original',
      responsePolicy: 'mentioned',
      mentions: [{ kind: 'agent', logicalAgentId: 'a' }],
      idempotencyKey: 'second-private-source',
    });
    const secondClaim = await guard.roomClient.claimWake({
      roomId,
      roomMessageId: (secondMessage.message as any).messageId,
      logicalAgentId: 'a',
      hostParticipantId: 'xiaok-desktop',
    });
    expect(secondClaim.ok).toBe(true);
    // Negative settlement keeps the same original host/token fact after the
    // service lifetime ends; no new positive admission is requested.
    await service.stop();
    await expect(
      guard.roomClient.completeWake({
        roomId,
        claimToken: String(secondClaim.claimToken),
        reply: { kind: 'text', text: 'MUST_NOT_PUBLISH' },
      }),
    ).rejects.toThrow();
    const abandoned = await guard.roomClient.abandonWake({
      roomId,
      claimToken: String(secondClaim.claimToken),
    });
    expect(abandoned.ok, JSON.stringify(abandoned)).toBe(true);
    expect(abandoned.wakeStatus).toBe('failed');
    expect(replaced).toHaveBeenCalledTimes(0);
    expect(caller).toHaveBeenCalledTimes(0);
    expect(publicGetters).toBe(0);
  } finally {
    await service.stop();
    await server.close();
    isolatedConfig.ports.clear();
    broker.close();
    if (oldConfig === undefined) delete process.env.XIAOK_CONFIG_DIR;
    else process.env.XIAOK_CONFIG_DIR = oldConfig;
    rmSync(root, { recursive: true, force: true });
  }
}, 20000);

it('rejects foreign and copied authorities before any Proxy or accessor is observed', () => {
  let traps = 0;
  const foreign = new Proxy(
    {},
    {
      get() {
        traps++;
        throw Error('get');
      },
      ownKeys() {
        traps++;
        throw Error('keys');
      },
      getOwnPropertyDescriptor() {
        traps++;
        throw Error('descriptor');
      },
    },
  );
  expect(
    scopeModule.readOptionalOriginalScopedRoomWakeAcceptance(foreign),
  ).toBeUndefined();
  expect(
    scopeModule.bindOriginalRoomProjectScopeGuardClient(foreign, foreign),
  ).toBe(false);
  expect(() =>
    workspaceModule.bindOriginalRoomWorkspaceDiscussionClient(foreign, foreign),
  ).toThrow('ROOM_SCOPED_ORIGINAL_WORKSPACE_REQUIRED');
  expect(() =>
    serviceModule.readOriginalKSwarmRoomProjectMappingIO(foreign),
  ).toThrow();
  expect(() =>
    dispatcherModule.bindOriginalScopedRoomWakeDispatcher(foreign, foreign),
  ).toThrow();
  expect(traps).toBe(0);
});

it('uses the original owned KSwarm project endpoint and never a replaced public request', async () => {
  const root = mkdtempSync(join(tmpdir(), 'scoped-original-project-'));
  const prior = {
    config: process.env.XIAOK_CONFIG_DIR,
    data: process.env.KSWARM_DATA_ROOT,
  };
  process.env.XIAOK_CONFIG_DIR = join(root, 'config');
  process.env.KSWARM_DATA_ROOT = join(root, 'kswarm');
  const nativeImport = (specifier: string) =>
    import(/* @vite-ignore */ specifier);
  const siblings = resolve(process.cwd(), '../..');
  const { createBrokerService } = await nativeImport(
    pathToFileURL(join(siblings, 'intent-broker/src/broker/service.js')).href,
  );
  const { createServer } = await nativeImport(
    pathToFileURL(join(siblings, 'intent-broker/src/http/server.js')).href,
  );
  const { createHub } = await nativeImport(
    pathToFileURL(join(siblings, 'kswarm/src/core/hub.js')).href,
  );
  const { spawn } = await import('node:child_process');
  const { createServer: reservePort } = await import('node:net');
  const reserved = reservePort();
  await new Promise<void>((yes) => reserved.listen(0, '127.0.0.1', yes));
  const kport = (reserved.address() as { port: number }).port;
  await new Promise<void>((yes, no) =>
    reserved.close((error) => (error ? no(error) : yes())),
  );
  isolatedConfig.ports.set('4400', kport);
  const children: import('node:child_process').ChildProcess[] = [];
  const service = serviceModule.createKSwarmService({
    findPortOwner: async () => null,
    spawnProcess: ((command: string, args: string[], options: any) => {
      expect(args[0]).toBe(join(siblings, 'kswarm/src/server/index.js'));
      const child = spawn(command, args, {
        ...options,
        env: {
          ...options.env,
          KSWARM_PORT: String(kport),
          BROKER_URL: `http://127.0.0.1:${isolatedConfig.ports.get('4318')}`,
        },
      });
      children.push(child);
      return child;
    }) as typeof spawn,
  });
  const token = service.getIntentBrokerRoomToken();
  const broker = createBrokerService({ dbPath: join(root, 'broker.sqlite') });
  const server = createServer({
    broker,
    roomService: broker.room,
    roomDesktopToken: token,
  });
  await server.listen(0, '127.0.0.1');
  isolatedConfig.ports.set('4318', server.address().port);
  try {
    const rawModule = await import(
      '../../electron/collaboration-room-broker-client.js'
    );
    const client = rawModule.createCollaborationRoomBrokerClient({ token });
    const workspace = workspaceModule.createRoomWorkspaceBrokerClient({
      token,
      isMutationOwner: () => true,
    });
    const caller = vi.fn(async () => {
      throw Error('caller policy is not authority');
    });
    const guard = scopeModule.createRoomProjectScopeGuard({
      roomClient: client,
      workspaceBroker: workspace,
      kswarmRequest: caller,
    });
    scopeModule.bindOriginalRoomProjectScopeGuardClient(
      guard.roomClient,
      service,
    );
    const created = await client.createRoom({
      title: 'project original',
      memberAgentIds: ['a', 'outsider'],
    });
    const roomId = (created.room as any).roomId;
    const seed = createHub({
      silent: true,
      dataDir: {
        backend: 'sqlite',
        filePath: join(root, 'kswarm/state.sqlite'),
        silent: true,
      },
    });
    const project = seed.createProject({
      id: 'p',
      name: 'p',
      goal: 'fixture',
      poAgent: 'po',
      members: ['a'],
      autoAssignPo: false,
    });
    project.primaryRoomId = roomId;
    seed.persistState();
    seed.closePersistence();
    const sent = await client.sendRoomMessage({
      roomId,
      text: 'project body',
      contextScope: { kind: 'project', projectId: 'p' },
      responsePolicy: 'mentioned',
      mentions: [
        { kind: 'agent', logicalAgentId: 'a' },
        { kind: 'agent', logicalAgentId: 'outsider' },
      ],
      idempotencyKey: 'project-source',
    });
    const roomMessageId = (sent.message as any).messageId;
    const replaced = vi.fn(async () => {
      throw Error('public service request replaced');
    });
    service.request = replaced;
    const facet = scopeModule.readOptionalOriginalScopedRoomWakeAcceptance(
      guard.roomClient,
    )!;
    const { createRoomTurnCustody } = await import(
      '../../electron/original-room-turn-custody.js'
    );
    const denied = createRoomTurnCustody();
    await expect(
      facet.collect(
        { roomId, roomMessageId, logicalAgentIds: ['outsider'] },
        denied,
      ),
    ).rejects.toThrow('room_project_access_denied');
    const current = createRoomTurnCustody();
    expect(
      (
        await facet.collect(
          { roomId, roomMessageId, logicalAgentIds: ['a'] },
          current,
        )
      ).ok,
    ).toBe(true);
    expect(children.length).toBe(1);
    expect(children[0]!.pid).toBeGreaterThan(0);
    const originalLease =
      serviceModule.readOriginalKSwarmRoomProjectMappingIO(service);
    await originalLease.read(
      'p',
      'a',
      createRoomTurnCustody(),
      new AbortController().signal,
    );
    const connected = Object.getOwnPropertyDescriptor(
      children[0]!,
      'connected',
    )!;
    expect(connected.value).toBe(true);
    Object.defineProperty(children[0]!, 'connected', {
      ...connected,
      value: false,
    });
    expect(() => originalLease.assertLocal()).toThrow(
      'KSWARM_ROOM_PROJECT_MAPPING_NOT_CONNECTED',
    );
    Object.defineProperty(children[0]!, 'connected', connected);
    // Restoring the observed SDK field does not revive this original lease.
    expect(() => originalLease.assertLocal()).toThrow(
      'KSWARM_ROOM_PROJECT_MAPPING_NOT_CURRENT',
    );
    const claim = await guard.workspaceBroker.request(roomId, 'claim-wake', {
      roomMessageId,
      logicalAgentId: 'a',
      hostParticipantId: 'xiaok-desktop',
      discussionOnly: true,
    });
    expect(claim.ok, JSON.stringify(claim)).toBe(true);
    const deleted = await fetch(`http://127.0.0.1:${kport}/projects/p`, {
      method: 'DELETE',
      headers: { 'x-kswarm-mutation-token': service.getDesktopMutationToken() },
    });
    expect((await deleted.json()).ok).toBe(true);
    await expect(
      guard.roomClient.listRoomMessagesPage({
        roomId,
        claimToken: claim.claimToken,
      }),
    ).rejects.toThrow('room_project_access_denied');
    const abandoned = await guard.roomClient.abandonWake({
      roomId,
      claimToken: String(claim.claimToken),
    });
    expect(abandoned.ok).toBe(true);
    expect(caller).toHaveBeenCalledTimes(0);
    expect(replaced).toHaveBeenCalledTimes(0);
    await service.stop();
    expect(() =>
      serviceModule
        .readOriginalKSwarmRoomProjectMappingIO(service)
        .assertLocal(),
    ).toThrow();
    console.log(
      JSON.stringify({
        ownedChildren: children.map((child) => ({
          pid: child.pid,
          exitCode: child.exitCode,
          signalCode: child.signalCode,
        })),
        callerCalls: caller.mock.calls.length,
        publicCalls: replaced.mock.calls.length,
      }),
    );
  } finally {
    await service.stop();
    await server.close();
    isolatedConfig.ports.clear();
    broker.close();
    for (const [key, value] of [
      ['XIAOK_CONFIG_DIR', prior.config],
      ['KSWARM_DATA_ROOT', prior.data],
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(root, { recursive: true, force: true });
  }
}, 30000);

it('pins exact original transport/service relationships and keeps foreign copies passive', async () => {
  const rawModule = await import(
    '../../electron/collaboration-room-broker-client.js'
  );
  const first = serviceModule.createKSwarmService(),
    second = serviceModule.createKSwarmService();
  const token = first.getIntentBrokerRoomToken();
  const raw = rawModule.createCollaborationRoomBrokerClient({ token });
  const workspace = workspaceModule.createRoomWorkspaceBrokerClient({
    token,
    isMutationOwner: () => true,
  });
  const guard = scopeModule.createRoomProjectScopeGuard({
    roomClient: raw,
    workspaceBroker: workspace,
    kswarmRequest: async () => {
      throw Error('never');
    },
  });
  expect(() =>
    scopeModule.readOptionalOriginalScopedRoomWakeAcceptance(guard.roomClient),
  ).toThrow('ROOM_SCOPED_ORIGINAL_BINDING_REQUIRED');
  expect(() =>
    scopeModule.bindOriginalRoomProjectScopeGuardClient(
      guard.roomClient,
      second,
    ),
  ).toThrow();
  expect(
    scopeModule.bindOriginalRoomProjectScopeGuardClient(
      guard.roomClient,
      first,
    ),
  ).toBe(true);
  expect(
    scopeModule.bindOriginalRoomProjectScopeGuardClient(
      guard.workspaceBroker,
      first,
    ),
  ).toBe(true);
  expect(() =>
    scopeModule.bindOriginalRoomProjectScopeGuardClient(
      guard.roomClient,
      second,
    ),
  ).toThrow();
  expect(
    scopeModule.readOptionalOriginalScopedRoomWakeAcceptance({
      ...guard.roomClient,
    }),
  ).toBeUndefined();
  expect(
    scopeModule.bindOriginalRoomProjectScopeGuardClient(
      { ...guard.roomClient },
      first,
    ),
  ).toBe(false);
  let traps = 0;
  const proxy = new Proxy(guard.roomClient, {
    get() {
      traps++;
      throw Error('get');
    },
    ownKeys() {
      traps++;
      throw Error('keys');
    },
  });
  expect(
    scopeModule.readOptionalOriginalScopedRoomWakeAcceptance(proxy),
  ).toBeUndefined();
  expect(
    scopeModule.bindOriginalRoomProjectScopeGuardClient(proxy, first),
  ).toBe(false);
  expect(traps).toBe(0);
  const foreignWorkspace = workspaceModule.createRoomWorkspaceBrokerClient({
    token: second.getIntentBrokerRoomToken(),
    isMutationOwner: () => true,
  });
  const mismatched = scopeModule.createRoomProjectScopeGuard({
    roomClient: raw,
    workspaceBroker: foreignWorkspace,
    kswarmRequest: async () => {
      throw Error('never');
    },
  });
  expect(() =>
    scopeModule.bindOriginalRoomProjectScopeGuardClient(
      mismatched.roomClient,
      first,
    ),
  ).toThrow();
  await first.stop();
  await second.stop();
});
