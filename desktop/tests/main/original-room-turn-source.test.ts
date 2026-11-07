// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compileFunction, constants } from 'node:vm';
// Explicit closed Native environment: this component fixture grants no Main role.
vi.mock('electron', () => ({ app: { isReady: () => false }, BrowserWindow: { getAllWindows: () => [], fromId: () => null, fromWebContents: () => null }, webContents: { fromId: () => null } }));
const cleanups: Array<() => Promise<unknown> | unknown> = [];
afterEach(async () => {
    const errors: unknown[] = [];
    for (let i = cleanups.length - 1; i >= 0; i--)
        try {
            await cleanups[i]!();
        }
        catch (error) {
            errors.push(error);
        }
    cleanups.length = 0;
    if (errors.length)
        throw new AggregateError(errors, 'fixture cleanup failed');
});
function visibleResponseState(response: Response): {
    key: PropertyKey;
    row: PropertyDescriptor;
} {
    const native = Reflect.ownKeys(response).find(key => typeof key === 'symbol' && key.description === 'state');
    if (native)
        return { key: native, row: Object.getOwnPropertyDescriptor(response, native)! };
    const key = Symbol('fixture-visible-resource-state');
    Object.defineProperty(response, key, { configurable: true, writable: true, value: Object.create(null) });
    console.log(JSON.stringify({ fixtureResourceSlot: true, defaultNativeStateNotVisible: true, notNativeStartupQualification: true }));
    return { key, row: Object.getOwnPropertyDescriptor(response, key)! };
}
const scope = { profileId: 'a'.repeat(64), workspaceId: 'b'.repeat(64) };
async function load() {
    return import('../../electron/original-room-turn-source.js');
}
async function fixture(options: {
    canExecute?: (agent: string) => Promise<boolean>;
    fetch?: (input: unknown, init?: RequestInit) => Promise<Response>;
} = {}) {
    const api = await load();
    expect(api.createOriginalRoomTurnSource).toBeTypeOf('function');
    const root = mkdtempSync(join(tmpdir(), 'room-accepted-source-'));
    cleanups.push(() => rmSync(root, { recursive: true, force: true }));
    const nativeImport = compileFunction('return import(path)', ['path'], { importModuleDynamically: constants.USE_MAIN_CONTEXT_DEFAULT_LOADER });
    const { createBrokerService } = await nativeImport(pathToFileURL(resolve('../../intent-broker/src/broker/service.js')).href);
    const { createServer } = await nativeImport(pathToFileURL(resolve('../../intent-broker/src/http/server.js')).href);
    const broker = createBrokerService({ dbPath: join(root, 'broker.sqlite') }), server = createServer({ broker, roomService: broker.room, roomDesktopToken: 'fixture-room-only' });
    await server.listen(0, '127.0.0.1');
    cleanups.push(async () => {
        await server.close();
        broker.close();
    });
    const base = `http://127.0.0.1:${server.address().port}`;
    const { createCollaborationRoomBrokerClient } = await import('../../electron/collaboration-room-broker-client.js');
    const client = createCollaborationRoomBrokerClient({ token: 'fixture-room-only', fetchImpl: (input, init) => options.fetch ? options.fetch(base + new URL(String(input)).pathname, init) : fetch(base + new URL(String(input)).pathname, init) });
    const created: any = await client.createRoom({ title: 'Original accepted turn', memberAgentIds: ['agent-a', 'agent-b'] });
    expect(created.ok).toBe(true);
    const roomId = created.room.roomId;
    const sent: any = await client.sendRoomMessage({ roomId, text: 'original source message', responsePolicy: 'mentioned', mentions: [{ kind: 'agent', logicalAgentId: 'agent-a' }, { kind: 'agent', logicalAgentId: 'agent-b' }], idempotencyKey: 'first-original' });
    expect(sent.ok).toBe(true);
    const { createDesktopServices } = await import('../../electron/desktop-services.js');
    const effects = vi.fn(async () => {
        throw Error('acceptance must not execute');
    });
    const services = createDesktopServices({ dataRoot: join(root, 'desktop'), runner: effects, kswarmService: { request: async () => new Response('{}'), getDesktopMutationToken: () => '' } as never });
    cleanups.push(() => services.closeTaskSourceWritersForMigration());
    const { RoomWorkspaceLocalStore } = await import('../../electron/room-workspace-local.js');
    const store = new RoomWorkspaceLocalStore(join(root, 'workspace.sqlite'));
    cleanups.push(() => store.close());
    const { createRoomWorkspaceRuntime } = await import('../../electron/room-workspace-runtime.js');
    const claim = vi.fn(async () => {
        throw Error('acceptance must not claim');
    });
    let expectedSourceFailure = false;
    const componentCleanup = async (work: () => Promise<unknown>) => {
        try {
            await work();
        }
        catch (error) {
            if (!expectedSourceFailure)
                throw error;
            console.log(JSON.stringify({ componentSourceUnconfirmed: true, notProductDrain: true }));
        }
    };
    const runtime = createRoomWorkspaceRuntime({ store, broker: { get: claim, request: claim }, wake: { claimWake: claim, completeWake: claim }, execute: services.runCollaborationRoomAgentTask, ensureProtocol: claim });
    cleanups.push(() => componentCleanup(() => runtime.shutdown()));
    const { createCollaborationRoomWakeDispatcher } = await import('../../electron/collaboration-room-wake-dispatcher.js');
    const canExecute = options.canExecute ?? vi.fn(async () => true), dispatcher = createCollaborationRoomWakeDispatcher({ brokerClient: client, execute: services.runCollaborationRoomAgentTask, executeTurn: runtime.run, canExecute });
    const source = api.createOriginalRoomTurnSource({ dispatcher, runtime, services, scope });
    cleanups.push(() => componentCleanup(() => source.drain()));
    return { api, source, runtime, dispatcher, services, client, effects, root, claim, canExecute, expectSourceFailure() {
            expectedSourceFailure = true;
        }, input: { roomId, roomMessageId: sent.message.messageId, logicalAgentIds: ['agent-a'] } };
}
it('accepts only the real original broker message without claiming, running or issuing Native/N', async () => {
    const f = await fixture(), proofs = await f.source.acceptMessage(f.input);
    expect(proofs).toHaveLength(1);
    const view = f.api.readOriginalRoomTurnRoot(f.source, proofs[0]!);
    expect(view).toMatchObject({ scope, roomId: f.input.roomId, messageId: f.input.roomMessageId, logicalAgentId: 'agent-a', priorityClass: 'background' });
    expect(view.turnId).toBeTruthy();
    expect(Object.isFrozen(view)).toBe(true);
    expect(f.effects).not.toHaveBeenCalled();
    expect(f.claim).not.toHaveBeenCalled();
});
it('requires original factory members and exact source/proof identity before reading any candidate property', async () => {
    const f = await fixture(), proof = (await f.source.acceptMessage(f.input))[0]!;
    let getters = 0;
    const foreign = new Proxy({}, { get() {
            getters++;
            throw Error('get');
        }, getPrototypeOf() {
            getters++;
            throw Error('prototype');
        } });
    expect(() => f.api.readOriginalRoomTurnRoot(f.source, foreign)).toThrow();
    expect(() => f.api.readOriginalRoomTurnRoot(f.source, { ...proof })).toThrow();
    expect(() => f.api.readOriginalRoomTurnRoot(foreign, proof)).toThrow();
    expect(() => f.api.createOriginalRoomTurnSource({ dispatcher: { ...f.dispatcher }, runtime: f.runtime, services: f.services, scope })).toThrow();
    expect(getters).toBe(0);
});
it('keeps a stable turn per actual message and agent and fans out independently', async () => {
    const f = await fixture(), a = (await f.source.acceptMessage(f.input))[0]!, again = (await f.source.acceptMessage(f.input))[0]!;
    expect(f.api.readOriginalRoomTurnRoot(f.source, a).turnId).toBe(f.api.readOriginalRoomTurnRoot(f.source, again).turnId);
    const all = await f.source.acceptMessage({ ...f.input, logicalAgentIds: ['agent-a', 'agent-b', 'agent-a'] });
    expect(all).toHaveLength(2);
    expect(new Set(Array.from(all).map(p => f.api.readOriginalRoomTurnRoot(f.source, p).turnId)).size).toBe(2);
    expect(f.claim).not.toHaveBeenCalled();
});
it('denies missing message and unsupported or absent actual member before acceptance', async () => {
    const f = await fixture({ canExecute: async (agent) => agent !== 'agent-b' });
    await expect(f.source.acceptMessage({ ...f.input, roomMessageId: 'missing' })).rejects.toThrow();
    await expect(f.source.acceptMessage({ ...f.input, logicalAgentIds: ['not-member'] })).rejects.toThrow();
    await expect(f.source.acceptMessage({ ...f.input, logicalAgentIds: ['agent-b'] })).rejects.toThrow();
    expect(f.claim).not.toHaveBeenCalled();
});
it('denies another genuine composition proof and ignores public property shadows', async () => {
    const a = await fixture(), b = await fixture(), foreign = (await b.source.acceptMessage(b.input))[0]!;
    expect(() => a.api.readOriginalRoomTurnRoot(a.source, foreign)).toThrow();
    Object.defineProperty(a.client, 'getRoomSnapshot', { value: () => {
            throw Error('shadow snapshot');
        } });
    Object.defineProperty(a.runtime, 'run', { value: () => {
            throw Error('shadow runtime');
        } });
    Object.defineProperty(a.services, 'runCollaborationRoomAgentTask', { value: () => {
            throw Error('shadow runner');
        } });
    const proof = (await a.source.acceptMessage(a.input))[0]!;
    expect(a.api.readOriginalRoomTurnRoot(a.source, proof).messageId).toBe(a.input.roomMessageId);
    expect(a.claim).not.toHaveBeenCalled();
});
it.each(['room-id', 'room-status', 'member'])('rejects actual response %s mismatches', async (mode) => {
    let armed = false;
    const f = await fixture({ fetch: async (input, init) => {
            const response = await fetch(String(input), init);
            if (!armed)
                return response;
            const value: any = await response.json();
            if (mode === 'room-id')
                value.room.roomId = 'other-room';
            if (mode === 'room-status')
                value.room.status = 'archived';
            if (mode === 'member')
                value.members = [];
            return Response.json(value);
        } });
    armed = true;
    await expect(f.source.acceptMessage(f.input)).rejects.toThrow();
    expect(f.claim).not.toHaveBeenCalled();
});
it('reserves its admission Root before a synchronous SDK can seal and start drain', async () => {
    let f: Awaited<ReturnType<typeof fixture>> | undefined, drained = false, closing: Promise<void> | undefined;
    let release!: () => void;
    const held = new Promise<boolean>(yes => {
        release = () => yes(true);
    });
    f = await fixture({ canExecute: () => {
            f!.source.seal();
            closing = f!.source.drain().then(() => {
                drained = true;
            });
            return held;
        } });
    const accepting = f.source.acceptMessage(f.input).then(() => ({ accepted: true }), error => ({ accepted: false, error }));
    await vi.waitFor(() => expect(closing).toBeTruthy());
    await new Promise(yes => setTimeout(yes, 20));
    expect(drained).toBe(false);
    release();
    expect((await accepting).accepted).toBe(false);
    await closing;
    expect(drained).toBe(true);
    expect(f.claim).not.toHaveBeenCalled();
});
it('keeps raw Promise own symbol siblings even when the logical probe has fulfilled', async () => {
    let release!: () => void;
    const held = new Promise<void>(yes => {
        release = yes;
    });
    const f = await fixture({ canExecute: () => {
            const raw = Promise.resolve(true);
            Object.defineProperty(raw, Symbol('raw-sidecar'), { value: held });
            return raw;
        } });
    expect(await f.source.acceptMessage(f.input)).toHaveLength(1);
    let drained = false;
    const closing = f.source.drain().then(() => {
        drained = true;
    });
    await new Promise(yes => setTimeout(yes, 20));
    expect(drained).toBe(false);
    release();
    await closing;
});
it('keeps Promise outcomes and first SDK error sidecars in its physical frontier', async () => {
    let release!: () => void;
    const held = new Promise<void>(yes => {
        release = yes;
    }), failure = Object.assign(Error('original probe failed'), { nested: { tail: held } }), f = await fixture({ canExecute: async () => {
            throw failure;
        } });
    f.expectSourceFailure();
    await expect(f.source.acceptMessage(f.input)).rejects.toBe(failure);
    let done = false;
    const closing = f.source.drain().then(() => {
        done = true;
    }, error => {
        done = true;
        return error;
    });
    await new Promise(yes => setTimeout(yes, 20));
    expect(done).toBe(false);
    release();
    expect(await closing).toBe(failure);
});
it('observes an outcome-discovered Promise and then the Promise own future sibling', async () => {
    let releaseOuter!: (value: unknown) => void, releaseInner!: () => void;
    const inner = new Promise<void>(yes => {
        releaseInner = yes;
    }), outer = new Promise<unknown>(yes => {
        releaseOuter = yes;
    });
    const f = await fixture({ canExecute: () => {
            const raw = Promise.resolve(true);
            Object.defineProperty(raw, Symbol('outer'), { value: outer });
            return raw;
        } });
    await f.source.acceptMessage(f.input);
    let done = false;
    const closing = f.source.drain().then(() => {
        done = true;
    });
    releaseOuter({ discovered: inner });
    await new Promise(yes => setTimeout(yes, 20));
    expect(done).toBe(false);
    releaseInner();
    await closing;
});
it('preserves undefined failure presence through later current and drain', async () => {
    const f = await fixture({ canExecute: async () => {
            throw undefined;
        } });
    f.expectSourceFailure();
    let reason: unknown = 1;
    try {
        await f.source.acceptMessage(f.input);
    }
    catch (error) {
        reason = error;
    }
    expect(reason).toBeUndefined();
    let rejected = false;
    try {
        await f.source.drain();
    }
    catch (error) {
        rejected = true;
        expect(error).toBeUndefined();
    }
    expect(rejected).toBe(true);
    await expect(f.source.acceptMessage(f.input)).rejects.toBeUndefined();
});
it('normal Source seal keeps an accepted read current but actual runtime shutdown revokes it', async () => {
    const f = await fixture(), proof = (await f.source.acceptMessage(f.input))[0]!;
    f.source.seal();
    expect(f.api.readOriginalRoomTurnRoot(f.source, proof).messageId).toBe(f.input.roomMessageId);
    await f.source.drain();
    await f.runtime.shutdown();
    expect(() => f.api.assertOriginalRoomTurnRootCurrent(f.source, proof)).toThrow();
});
it('does not use Response instance json override to end an actually held Native body', async () => {
    let armed = false, release!: () => void, entered = false;
    const f = await fixture({ fetch: async (input, init) => {
            const actual = await fetch(String(input), init);
            if (!armed)
                return actual;
            const json = await actual.text();
            const response = new Response(new ReadableStream({ start(controller) {
                    release = () => {
                        controller.enqueue(new TextEncoder().encode(json));
                        controller.close();
                    };
                } }));
            Object.defineProperty(response, 'json', { value: () => Promise.resolve(JSON.parse(json)) });
            entered = true;
            return response;
        } });
    armed = true;
    f.expectSourceFailure();
    const accepting = f.source.acceptMessage(f.input).then(() => ({ accepted: true }), error => ({ accepted: false, error }));
    await vi.waitFor(() => expect(entered).toBe(true));
    let done = false;
    const closing = f.source.drain().then(() => {
        done = true;
    }, error => {
        done = true;
        return error;
    });
    await new Promise(yes => setTimeout(yes, 20));
    expect(done).toBe(false);
    release();
    expect((await accepting).accepted).toBe(false);
    expect(await closing).toBeUndefined();
});
it('tracks a held Promise inside the real Native Response existing symbol state', async () => {
    let armed = false, hits = 0, release!: () => void;
    const held = new Promise<void>(yes => {
        release = yes;
    });
    const f = await fixture({ fetch: async (input, init) => {
            const response = await fetch(String(input), init);
            if (armed) {
                const { key, row } = visibleResponseState(response);
                expect(row && 'value' in row).toBe(true);
                Object.defineProperty(row!.value, Symbol('response-state-tail'), { value: held });
                hits++;
            }
            return response;
        } });
    armed = true;
    try {
        await f.source.acceptMessage(f.input);
        expect(hits).toBe(1);
        let done = false;
        const close = f.source.drain().then(() => {
            done = true;
        });
        await new Promise(yes => setTimeout(yes, 20));
        expect(done).toBe(false);
        release();
        await close;
    }
    finally {
        release();
    }
});
it('registers an original accept-kernel Error own tail before releasing its admission Root', async () => {
    const original = Date.prototype.toISOString;
    let release!: () => void;
    const held = new Promise<void>(yes => {
        release = yes;
    }), error = Object.assign(Error('actual accept kernel error'), { nested: held });
    const f = await fixture({ canExecute: async () => {
            Date.prototype.toISOString = function () {
                throw error;
            };
            return true;
        } });
    try {
        await expect(f.source.acceptMessage(f.input)).rejects.toBe(error);
        Date.prototype.toISOString = original;
        let done = false;
        const close = f.source.drain().then(() => {
            done = true;
        });
        await new Promise(yes => setTimeout(yes, 20));
        expect(done).toBe(false);
        release();
        await close;
    }
    finally {
        Date.prototype.toISOString = original;
        release();
    }
});
it.each(['keys', 'descriptor'])('keeps original Native resource %s trap errors and known Error sidecars', async (mode) => {
    let armed = false, hits = 0, release!: () => void;
    const held = new Promise<void>(yes => {
        release = yes;
    }), failure = Object.assign(Error('original resource reflection SDK error'), { tail: held });
    const f = await fixture({ fetch: async (input, init) => {
            const response = await fetch(String(input), init);
            if (armed) {
                const { key, row } = visibleResponseState(response);
                Object.defineProperty(row.value, 'fixtureReflectionFault', { value: true, configurable: true });
                const state = new Proxy(row.value, { ownKeys(target) {
                        if (mode === 'keys') {
                            hits++;
                            throw failure;
                        }
                        return Reflect.ownKeys(target);
                    }, getOwnPropertyDescriptor(target, name) {
                        if (mode === 'descriptor' && name === 'fixtureReflectionFault') {
                            hits++;
                            throw failure;
                        }
                        return Reflect.getOwnPropertyDescriptor(target, name);
                    } });
                Object.defineProperty(response, key, { ...row, value: state });
            }
            return response;
        } });
    armed = true;
    f.expectSourceFailure();
    try {
        await expect(f.source.acceptMessage(f.input)).rejects.toBe(failure);
        expect(hits).toBeGreaterThan(0);
        let done = false;
        const close = f.source.drain().then(() => {
            done = true;
        }, error => {
            done = true;
            return error;
        });
        await new Promise(yes => setTimeout(yes, 20));
        expect(done).toBe(false);
        release();
        expect((await close).cause).toBe(failure);
    }
    finally {
        release();
    }
});
it.each(['plain', 'proxy'])('rejects a %s Response root before caller getter or Proxy trap', async (mode) => {
    let armed = false, getters = 0;
    const plain = Object.defineProperty({}, 'json', { get() {
            getters++;
            throw Error('json getter');
        } }), proxy = new Proxy({}, { get() {
            getters++;
            throw Error('proxy get');
        }, getPrototypeOf() {
            getters++;
            throw Error('proxy prototype');
        }, ownKeys() {
            getters++;
            throw Error('proxy keys');
        } });
    const f = await fixture({ fetch: (input, init) => armed ? (mode === 'plain' ? plain : proxy) as never : fetch(String(input), init) });
    armed = true;
    f.expectSourceFailure();
    await expect(f.source.acceptMessage(f.input)).rejects.toThrow();
    expect(getters).toBe(0);
});
it('rejects a Native Response own state accessor before the Native ok getter reads it', async () => {
    let armed = false, getters = 0, hits = 0;
    const f = await fixture({ fetch: async (input, init) => {
            const response = await fetch(String(input), init);
            if (armed) {
                const { key, row } = visibleResponseState(response);
                Object.defineProperty(response, key, { configurable: true, get() {
                        getters++;
                        return row.value;
                    } });
                hits++;
            }
            return response;
        } });
    armed = true;
    f.expectSourceFailure();
    await expect(f.source.acceptMessage(f.input)).rejects.toThrow();
    expect(hits).toBe(1);
    expect(getters).toBe(0);
});
it('keeps an unqualified SDK constructor getter untouched and joins its known sibling', async () => {
    let getters = 0, release!: () => void;
    const held = new Promise<void>(yes => {
        release = yes;
    });
    const f = await fixture({ canExecute: () => {
            const raw = Promise.resolve(true);
            Object.defineProperty(raw, 'constructor', { get() {
                    getters++;
                    throw Error('caller constructor');
                } });
            Object.defineProperty(raw, Symbol('known-sibling'), { value: held });
            return raw;
        } });
    f.expectSourceFailure();
    try {
        await expect(f.source.acceptMessage(f.input)).rejects.toThrow();
        let done = false;
        const close = f.source.drain().then(() => {
            done = true;
        }, error => {
            done = true;
            return error;
        });
        await new Promise(yes => setTimeout(yes, 20));
        expect(done).toBe(false);
        expect(getters).toBe(0);
        release();
        expect(await close).toMatchObject({ message: 'ROOM_TURN_SOURCE_SDK_UNCONFIRMED' });
    }
    finally {
        release();
    }
});
it('does not drop a known caller sibling when rejecting its foreign input envelope', async () => {
    let release!: () => void;
    const held = new Promise<void>(yes => {
        release = yes;
    }), f = await fixture();
    f.expectSourceFailure();
    const input = Object.assign(Object.create({ foreign: true }), f.input, { tail: held });
    try {
        await expect(f.source.acceptMessage(input)).rejects.toThrow();
        let done = false;
        const close = f.source.drain().then(() => {
            done = true;
        }, error => {
            done = true;
            return error;
        });
        await new Promise(yes => setTimeout(yes, 20));
        expect(done).toBe(false);
        release();
        expect(await close).toMatchObject({ message: 'ROOM_TURN_SOURCE_SDK_UNCONFIRMED' });
        expect(f.canExecute).not.toHaveBeenCalled();
    }
    finally {
        release();
    }
});
it('delivers only inert proof lists after a late inherited then hook', async () => {
    const original = Object.getOwnPropertyDescriptor(Object.prototype, 'then');
    let getters = 0;
    const f = await fixture({ canExecute: async () => {
            Object.defineProperty(Object.prototype, 'then', { configurable: true, get() {
                    getters++;
                    return undefined;
                } });
            return true;
        } });
    let proofs: readonly object[] | undefined;
    try {
        proofs = await f.source.acceptMessage(f.input);
    }
    finally {
        if (original)
            Object.defineProperty(Object.prototype, 'then', original);
        else
            delete (Object.prototype as {
                then?: unknown;
            }).then;
    }
    expect(proofs).toHaveLength(1);
    expect(getters).toBe(0);
});
it('preserves the original fixed Native getter failure before adding unknown resource status', async (context) => {
    let armed = false, hits = 0, release!: () => void;
    const held = new Promise<void>(yes => {
        release = yes;
    }), failure = Object.assign(Error('original Native status SDK error'), { tail: held });
    const f = await fixture({ fetch: async (input, init) => {
            const response = await fetch(String(input), init);
            if (armed) {
                const { key, row } = visibleResponseState(response);
                const state = new Proxy(row.value, { get(target, name, receiver) {
                        if (name === 'status') {
                            hits++;
                            throw failure;
                        }
                        return Reflect.get(target, name, receiver);
                    } });
                Object.defineProperty(response, key, { ...row, value: state });
            }
            return response;
        } });
    armed = true;
    f.expectSourceFailure();
    // Only Node22 exposes this real Native state slot. A hidden-state SDK needs
    // no such status getter dispatch and is covered by the other resource tests.
    if (!Reflect.ownKeys(new Response()).some(key => typeof key === 'symbol' && key.description === 'state'))
        context.skip();
    try {
        await expect(f.source.acceptMessage(f.input)).rejects.toBe(failure);
        expect(hits).toBeGreaterThan(0);
        const close = f.source.drain().catch(error => error);
        release();
        expect((await close).cause).toBe(failure);
    }
    finally {
        release();
    }
});
it('never exposes its private accepted proof to a late Object.freeze hook', async () => {
    const f = await fixture(), original = Object.freeze, seen: unknown[] = [];
    Object.freeze = ((value: unknown) => {
        seen.push(value);
        return original(value);
    }) as typeof Object.freeze;
    let proofs: readonly object[] | undefined;
    try {
        proofs = await f.source.acceptMessage(f.input);
    }
    finally {
        Object.freeze = original;
    }
    expect(proofs).toHaveLength(1);
    expect(seen.includes(proofs![0])).toBe(false);
});
it('never puts its accepted proof into a WeakMap born through a late global constructor', async () => {
    await load();
    const Original = WeakMap, get = WeakMap.prototype.get, seen: WeakMap<object, unknown>[] = [];
    globalThis.WeakMap = class extends Original {
        constructor(...args: any[]) {
            super(...args as [
                any
            ]);
            seen.push(this);
        }
    } as typeof WeakMap;
    let f: Awaited<ReturnType<typeof fixture>>, proofs: readonly object[] | undefined;
    try {
        f = await fixture();
        proofs = await f.source.acceptMessage(f.input);
    }
    finally {
        globalThis.WeakMap = Original;
    }
    expect(proofs).toHaveLength(1);
    expect(seen.some(map => Reflect.apply(get, map, [proofs![0]]) !== undefined)).toBe(false);
});

it('revalidates the actual original Broker and mints only its exact oneuse claim receipt',async()=>{
    const f=await fixture(),proof=(await f.source.acceptMessage(f.input))[0]!;
    expect((f.api as any).revalidateOriginalRoomTurnRoot).toBeTypeOf('function');
    await (f.api as any).revalidateOriginalRoomTurnRoot(f.source,proof);
    const claim=await (f.api as any).claimOriginalRoomTurnRoot(f.source,proof,'durable-host');
    const view=(f.api as any).readOriginalRoomTurnClaim(f.source,proof,claim);
    expect(view).toMatchObject({roomId:f.input.roomId,messageId:f.input.roomMessageId,logicalAgentId:'agent-a',hostId:'durable-host'});
    expect(view.claimToken).toBeTruthy();
    expect(()=> (f.api as any).readOriginalRoomTurnClaim(f.source,proof,{...claim})).toThrow();
    await expect((f.api as any).claimOriginalRoomTurnRoot(f.source,proof,'durable-host')).rejects.toThrow('ROOM_TURN_ALREADY_CLAIMED');
    const db=new DatabaseSync(join(f.root,'broker.sqlite'));
    try{expect(db.prepare('SELECT wake_status,claim_token FROM room_message_deliveries WHERE room_message_id=? AND recipient_key=?').get(f.input.roomMessageId,'agent:agent-a')).toMatchObject({wake_status:'claimed',claim_token:view.claimToken});}finally{db.close();}
    expect(f.effects).not.toHaveBeenCalled();
});
it('does not claim a formerly accepted candidate after actual Broker room archive',async()=>{
    const f=await fixture(),proof=(await f.source.acceptMessage(f.input))[0]!;
    await f.client.archiveRoom({roomId:f.input.roomId});
    expect((f.api as any).revalidateOriginalRoomTurnRoot).toBeTypeOf('function');
    await expect((f.api as any).revalidateOriginalRoomTurnRoot(f.source,proof)).rejects.toThrow();
    await expect((f.api as any).claimOriginalRoomTurnRoot(f.source,proof,'durable-host')).rejects.toThrow();
    expect(f.effects).not.toHaveBeenCalled();
});

it('does not assimilate a rejected original Native resource then getter and keeps its known sidecar',async()=>{
    const {createRoomTurnCustody}=await import('../../electron/original-room-turn-custody.js');
    const context=createRoomTurnCustody(),response=new Response('{}');
    let getters=0,release!:()=>void;
    const held=new Promise<void>(yes=>{release=yes;});
    Object.defineProperty(response,'then',{get(){getters++;return undefined;}});
    Object.defineProperty(response,Symbol('actual-response-held'),{value:held});
    const call=context.sdk(()=>response,undefined,[],{accept:value=>value===response,consumer:Response.prototype.json});
    let logical=false,closed=false;
    const observed=call.then(()=>{logical=true;},()=>{logical=true;});
    // The fixture owns this exact acquired handle even when delivery rejects.
    // Consume its real body; unknown/getter and the separate held tail remain.
    const body=context.consumeResource<unknown>(Response.prototype.json,response,[]);
    const drain=context.drain().then(()=>{closed=true;},()=>{closed=true;});
    try {
        await new Promise(yes=>setTimeout(yes,20));
        expect(getters).toBe(0);
        expect(closed).toBe(false);
        release();await observed;await body;await drain;
        expect(logical).toBe(true);
        expect(getters).toBe(0);
    } finally {release();await observed;await body;await drain;}
});

it('provides a fixed original Room Source Host Native admission composition',async()=>{
    const port=await import('../../electron/main-room-root-admission.js');
    expect(port.createOriginalMainRoomRootAdmissionPort).toBeTypeOf('function');
});

it('exports one Main RootAdmissionOwner rather than a pool per root facet',async()=>{
    const api=await import('../../electron/main-room-root-admission.js');
    expect((api as any).createOriginalMainRootAdmissionOwner).toBeTypeOf('function');
});
