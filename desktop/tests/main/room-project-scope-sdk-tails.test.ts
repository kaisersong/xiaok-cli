// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
vi.mock('electron', () => ({ app: { isReady: () => false } }));

it.each([
  'held',
  'error',
  'proxy',
  'getter',
  'public_held',
  'nested_unknown',
] as const)(
  'retains actual SDK raw/outcome/error inventory: %s',
  async (mode) => {
    const root = mkdtempSync(join(tmpdir(), 'scoped-room-sdk-tails-'));
    const priorConfig = process.env.XIAOK_CONFIG_DIR,
      nativeFetch = globalThis.fetch;
    process.env.XIAOK_CONFIG_DIR = join(root, 'config');
    let brokerPort: number | undefined;
    let arm = false,
      hits = 0,
      traps = 0,
      getters = 0,
      proxyResponse: Response | undefined,
      originalResponse: Response | undefined,
      releaseRaw!: () => void,
      releaseResponse!: () => void;
    const rawTail = new Promise<void>((yes) => {
        releaseRaw = yes;
      }),
      responseTail = new Promise<void>((yes) => {
        releaseResponse = yes;
      });
    const originalError = Error('original SDK error');
    Object.defineProperty(originalError, Symbol('error-tail'), {
      value: responseTail,
    });
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      if (arm && mode === 'proxy') {
        hits++;
        return new Proxy(proxyResponse!, {
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
        }) as unknown as Promise<Response>;
      }
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.hostname === '127.0.0.1' && url.port === '4318') {
        if (brokerPort === undefined)
          throw Error('SCOPED_FIXTURE_ENDPOINT_NOT_READY');
        url.port = String(brokerPort);
      }
      const original = nativeFetch(url, init);
      if (!arm) return original;
      const raw = original.then(async (response) => {
        hits++;
        originalResponse = response;
        if (mode === 'nested_unknown') {
          Object.defineProperty(response, Symbol('nested-unknown'), {
            value: Object.defineProperty({}, 'blocked', {
              get() {
                getters++;
                return 1;
              },
            }),
          });
          return response;
        }
        if (mode === 'held' || mode === 'public_held') {
          Object.defineProperty(response, Symbol('original-response-tail'), {
            value: responseTail,
          });
          return response;
        }
        await response.arrayBuffer();
        if (mode === 'error') throw originalError;
        return Object.defineProperty({}, 'status', {
          get() {
            getters++;
            return 200;
          },
        }) as Response;
      });
      Object.defineProperty(raw, Symbol('original-raw-tail'), {
        value: rawTail,
      });
      return raw;
    }) as typeof fetch;
    vi.resetModules();
    const siblings = resolve(process.cwd(), '../..'),
      nativeImport = (id: string) => import(/* @vite-ignore */ id);
    const { createBrokerService } = await nativeImport(
      pathToFileURL(join(siblings, 'intent-broker/src/broker/service.js')).href,
    );
    const { createServer } = await nativeImport(
      pathToFileURL(join(siblings, 'intent-broker/src/http/server.js')).href,
    );
    const serviceModule = await import('../../electron/kswarm-service.js');
    const brokerModule = await import(
      '../../electron/collaboration-room-broker-client.js'
    );
    const workspaceModule = await import(
      '../../electron/room-workspace-broker-client.js'
    );
    const guardModule = await import(
      '../../electron/room-project-scope-guard.js'
    );
    const { createRoomTurnCustody } = await import(
      '../../electron/original-room-turn-custody.js'
    );
    const service = serviceModule.createKSwarmService(),
      token = service.getIntentBrokerRoomToken();
    const broker = createBrokerService({ dbPath: join(root, 'broker.sqlite') }),
      server = createServer({
        broker,
        roomService: broker.room,
        roomDesktopToken: token,
      });
    await server.listen(0, '127.0.0.1');
    brokerPort = server.address().port;
    try {
      const client = brokerModule.createCollaborationRoomBrokerClient({
        token,
      });
      const workspace = workspaceModule.createRoomWorkspaceBrokerClient({
        token,
        isMutationOwner: () => true,
      });
      const guard = guardModule.createRoomProjectScopeGuard({
        roomClient: client,
        workspaceBroker: workspace,
        kswarmRequest: async () => {
          throw Error('not used');
        },
      });
      guardModule.bindOriginalRoomProjectScopeGuardClient(
        guard.roomClient,
        service,
      );
      const created = await client.createRoom({
          title: 'SDK stocks',
          memberAgentIds: ['a'],
        }),
        roomId = (created.room as any).roomId;
      const sent = await client.sendRoomMessage({
          roomId,
          text: 'visible tails',
          responsePolicy: 'mentioned',
          mentions: [{ kind: 'agent', logicalAgentId: 'a' }],
          idempotencyKey: 'tails',
        }),
        roomMessageId = (sent.message as any).messageId;
      if (mode === 'proxy') {
        // The test returns the actual native resource synchronously. Returning a
        // Proxy from an async fixture would itself read .then before custody.
        proxyResponse = await nativeFetch(
          `http://127.0.0.1:${brokerPort}/rooms/${roomId}/snapshot`,
          { headers: { 'x-intent-broker-room-token': token } },
        );
        await proxyResponse.arrayBuffer();
      }
      const context = createRoomTurnCustody();
      arm = true;
      if (mode === 'public_held') {
        let returned = false;
        const running = guard.roomClient
          .claimWake({
            roomId,
            roomMessageId,
            logicalAgentId: 'a',
            hostParticipantId: 'xiaok-desktop',
          })
          .then((reply) => {
            returned = true;
            return reply;
          });
        await vi.waitFor(() => expect(hits).toBe(3));
        expect(returned).toBe(false);
        releaseRaw();
        await new Promise((yes) => setImmediate(yes));
        expect(returned).toBe(false);
        releaseResponse();
        expect((await running).ok).toBe(true);
        expect(returned).toBe(true);
        return;
      }
      const collected = guardModule
        .readOptionalOriginalScopedRoomWakeAcceptance(guard.roomClient)!
        .collect({ roomId, roomMessageId, logicalAgentIds: ['a'] }, context);
      if (mode === 'held') expect((await collected).ok).toBe(true);
      else if (mode === 'error')
        await expect(collected).rejects.toBe(originalError);
      else await expect(collected).rejects.toThrow();
      arm = false;
      expect(hits).toBe(1);
      let done = false;
      const closing = context.waitPhysicalKnown().then(
        () => {
          done = true;
          return { ok: true };
        },
        (error) => {
          done = true;
          return { ok: false, error };
        },
      );
      await new Promise((yes) => setImmediate(yes));
      if (mode !== 'proxy') expect(done).toBe(false);
      releaseRaw();
      await new Promise((yes) => setImmediate(yes));
      if (mode === 'held' || mode === 'error') expect(done).toBe(false);
      releaseResponse();
      const fate = await closing;
      expect(done).toBe(true);
      expect(fate.ok).toBe(mode === 'held' || mode === 'error');
      expect(traps).toBe(0);
      expect(getters).toBe(0);
      if (mode === 'nested_unknown')
        expect(originalResponse!.bodyUsed).toBe(true);
      if (mode === 'proxy' || mode === 'getter' || mode === 'nested_unknown')
        expect(() => context.assertPhysicalKnown()).toThrow();
    } finally {
      arm = false;
      releaseRaw();
      releaseResponse();
      await service.stop();
      await server.close();
      broker.close();
      globalThis.fetch = nativeFetch;
      if (priorConfig === undefined) delete process.env.XIAOK_CONFIG_DIR;
      else process.env.XIAOK_CONFIG_DIR = priorConfig;
      rmSync(root, { recursive: true, force: true });
    }
  },
  15000,
);
