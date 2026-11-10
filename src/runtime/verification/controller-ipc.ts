import { types as ipcTypes } from 'node:util';
import { createRoomTurnCustody } from './original-sdk-custody.js';
import { createServer, createConnection, type Socket } from 'node:net';
import { chmodSync, existsSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { VERIFICATION_BUDGET } from './protocol.js';

const maximumBytes = VERIFICATION_BUDGET.rpcBytes;
function endpoint(path: string): void {
  if (typeof path !== 'string' || path.includes('\0') || !(isAbsolute(path) || (process.platform === 'win32' && /^\\\\\.\\pipe\\[A-Za-z0-9_.-]+$/.test(path)))) throw Error('controller_ipc_endpoint');
}
function timeout(value: number): number { if (!Number.isSafeInteger(value) || value < 1 || value > 900000) throw Error('controller_ipc_timeout_limit'); return value; }
function frame(bytes: Buffer): Buffer {
  if (!Buffer.isBuffer(bytes) || bytes.length > maximumBytes) throw Error('controller_ipc_frame_limit');
  const result = Buffer.allocUnsafe(4 + bytes.length); result.writeUInt32BE(bytes.length); bytes.copy(result, 4); return result;
}
/** Framing only: the protected daemon dispatcher must authenticate and authorize every operation. */
export async function startControllerIpc(options: {
  socketPath: string; requestTimeoutMs?: number;
  publicPeerAuthenticated?: true;
  acceptPeer?: (socket: Socket) => unknown;
  dispatch: (body: Buffer, signal: AbortSignal, peer?: unknown) => Promise<Buffer>;
}): Promise<{ close(): Promise<void> }> {
  const { socketPath, requestTimeoutMs, publicPeerAuthenticated, acceptPeer, dispatch } = options;
  endpoint(socketPath); const deadlineMs = timeout(requestTimeoutMs ?? 15000);
  if (publicPeerAuthenticated && (process.platform === 'win32' || typeof acceptPeer !== 'function')) throw Error('controller_public_peer_unavailable');
  const socketMode = publicPeerAuthenticated ? 0o666 : 0o600;
  if (typeof dispatch !== 'function') throw Error('controller_ipc_dispatcher');
  if (process.platform !== 'win32' && existsSync(socketPath)) throw Error('controller_ipc_endpoint_occupied');
  const sockets = new Set<Socket>();
  const pending = new Set<Promise<void>>();
  let admitted = 0;
  const server = createServer(socket => {
    if (admitted >= 4) { socket.destroy(); return; }
    let peer: unknown;
    try {
      peer = acceptPeer?.(socket);
      if (peer && typeof (peer as { then?: unknown }).then === 'function') {
        void Promise.resolve(peer).catch(() => {}); throw Error('controller_peer_async');
      }
    } catch { socket.destroy(); return; }
    admitted++; sockets.add(socket);
    const abort = new AbortController();
    const expiresAt = process.hrtime.bigint() + BigInt(deadlineMs) * 1_000_000n;
    let bytes = Buffer.alloc(0); let dispatched = false; let closed = false; let drained = true; let released = false;
    const release = () => { if (!released && closed && drained) { released = true; admitted--; } };
    const timer = setTimeout(() => socket.destroy(), deadlineMs);
    const destroy = () => { if (closed) return; closed = true; clearTimeout(timer); abort.abort(); sockets.delete(socket); bytes = Buffer.alloc(0); release(); };
    socket.on('error', () => socket.destroy());
    socket.on('close', destroy);
    socket.on('data', chunk => {
      if (closed || dispatched || process.hrtime.bigint() >= expiresAt || bytes.length + chunk.length > maximumBytes + 4) { socket.destroy(); return; }
      bytes = Buffer.concat([bytes, chunk]);
      if (bytes.length < 4) return;
      const length = bytes.readUInt32BE(0);
      if (length > maximumBytes || bytes.length > length + 4) { socket.destroy(); return; }
      if (bytes.length !== length + 4) return;
      dispatched = true; drained = false;
      const body = bytes.subarray(4); bytes = Buffer.alloc(0);
      // Assimilate both synchronous throws and rejected async work; disconnect never means rollback.
      const work = Promise.resolve().then(() => {
        if (abort.signal.aborted || process.hrtime.bigint() >= expiresAt) throw Error('controller_ipc_timeout_unknown');
        return dispatch(body, abort.signal, peer);
      }).then(result => {
        if (closed || process.hrtime.bigint() >= expiresAt) { socket.destroy(); return; }
        const response = frame(result);
        if (process.hrtime.bigint() >= expiresAt) { socket.destroy(); return; }
        socket.end(response);
      }).catch(() => { socket.destroy(); });
      pending.add(work); void work.then(() => { pending.delete(work); drained = true; release(); });
    });
  });
  try {
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(socketPath, () => { server.removeListener('error', reject); resolve(); }); });
    // Windows requires the installed service's named-pipe DACL; mode bits are not a Windows ACL proof.
    if (process.platform !== 'win32') chmodSync(socketPath, socketMode);
  } catch (error) { server.close(); throw error; }
  server.on('error', () => { for (const socket of sockets) socket.destroy(); });
  let closing: Promise<void> | undefined;
  return Object.freeze({ close() { return closing ??= new Promise<void>(resolve => { for (const socket of sockets) socket.destroy(); server.close(() => { void Promise.allSettled([...pending]).then(() => resolve()); }); }); } });
}

const IpcPromise = Promise, ipcThen = Promise.prototype.then;
const ipcApply = Reflect.apply, ipcDefine = Object.defineProperty;
const ipcGet = WeakMap.prototype.get, ipcSet = WeakMap.prototype.set;
const originalConnection = createConnection;
const ipcEventPhase = Object.getOwnPropertyDescriptor(Event.prototype, 'eventPhase')!.get!;
const ipcCalls = new WeakMap<object, {
    waitKnown(): Promise<void>;
    assertKnown(): void;
}>();
const ipcUnknown = () => { };
/** Original local transport bookkeeping only; this is not daemon, guest,
 * installed Main, engine-quiescence or resource-permit authorization. */
export function readOriginalControllerIpcPhysicalFate(originalCall: unknown): Readonly<{
    waitKnown(): Promise<void>;
    assertKnown(): void;
}> {
    if (!originalCall || typeof originalCall !== 'object' || ipcTypes.isProxy(originalCall))
        throw Error('controller_ipc_physical_unknown');
    const view = ipcApply(ipcGet, ipcCalls, [originalCall]) as {
        waitKnown(): Promise<void>;
        assertKnown(): void;
    } | undefined;
    if (!view)
        throw Error('controller_ipc_physical_unknown');
    return view;
}
export function callControllerIpc(socketPath: string, body: Buffer, options: {
    timeoutMs?: number;
    signal?: AbortSignal;
    verifyServerPeer?: (socket: Socket) => void;
} = {}): Promise<Buffer> {
    const { timeoutMs, signal, verifyServerPeer } = options;
    if (verifyServerPeer !== undefined && typeof verifyServerPeer !== 'function')
        throw Error('controller_server_peer_validator');
    endpoint(socketPath);
    const delay = timeout(timeoutMs ?? 15000), request = frame(body);
    const expiresAt = process.hrtime.bigint() + BigInt(delay) * 1000000n;
    const stock = createRoomTurnCustody();
    const lifetime = Object.create(null) as object;
    const peerResource = Object.create(null) as object;
    if (verifyServerPeer)
        ipcDefine(peerResource, 'callback', { __proto__: null, value: verifyServerPeer } as PropertyDescriptor);
    const retained: unknown[] = [];
    let socket: Socket | undefined, timer: ReturnType<typeof setTimeout> | undefined;
    let constructorEntered = false, timerEntered = false, socketClosed = false, sealed = false, unknown = false;
    let pendingContinuations = 0, publishing = false, published = false, resourceSequence = 0;
    let primaryPresent = false, primary: unknown, result: Buffer | undefined;
    let cleanup: Promise<void> | undefined, cleanupFinished = false, physicalKnown = false;
    let bytes = Buffer.alloc(0), abortInstalled = false;
    let yes!: (value: Buffer) => void, no!: (error: unknown) => void;
    const originalCall = new IpcPromise<Buffer>((resolve, reject) => { yes = resolve; no = reject; });
    let finishPhysical!: () => void;
    const physicalFinished = new IpcPromise<void>(resolve => { finishPhysical = resolve; });
    let closeSocket!: () => void;
    const closed = new IpcPromise<void>(resolve => { closeSocket = resolve; });
    const keep = (raw: unknown) => { retained[retained.length] = raw; };
    const inventory = (raw: unknown) => { keep(raw); stock.inventory(raw); };
    const first = (error: unknown) => {
        if (!primaryPresent) {
            primaryPresent = true;
            primary = error;
        }
        try {
            inventory(error);
        }
        catch (failure) {
            keep(failure);
            unknown = true;
            try {
                stock.inventory(ipcUnknown);
            }
            catch (secondary) {
                keep(secondary);
            }
        }
    };
    const opaque = () => {
        unknown = true;
        try {
            stock.inventory(ipcUnknown);
        }
        catch (failure) {
            keep(failure);
        }
    };
    // Internal continuation count is only a finish barrier, never a resource
    // queue. Inventory each derived tail after it settles, so cleanup cannot
    // wait on its own pending promise inside the same custody.
    const then = <T>(raw: Promise<T>, good: (value: T) => unknown, bad: (error: unknown) => unknown) => {
        pendingContinuations++;
        const tail = ipcApply(ipcThen, raw, [good, bad]) as Promise<unknown>;
        ipcDefine(tail, 'constructor', { __proto__: null, value: IpcPromise } as PropertyDescriptor);
        keep(tail);
        const complete = (rejected: boolean, value: unknown) => {
            try {
                if (rejected)
                    finish(true, value);
                inventory(tail);
                inventory(value);
            }
            catch (failure) {
                first(failure);
                opaque();
                finish(true, failure);
            }
            finally {
                pendingContinuations--;
                publish();
            }
        };
        const observer = ipcApply(ipcThen, tail, [
            (value: unknown) => complete(false, value),
            (error: unknown) => complete(true, error),
        ]) as Promise<unknown>;
        ipcDefine(observer, 'constructor', { __proto__: null, value: IpcPromise } as PropertyDescriptor);
        keep(observer);
        // Fixed final void sink: no foreign result can reject a detached tail.
        keep(ipcApply(ipcThen, observer, [undefined, (failure: unknown) => {
                first(failure);
                opaque();
                finish(true, failure);
            }]));
        return tail;
    };
    function publish(): void {
        if (!cleanupFinished || pendingContinuations || publishing || published)
            return;
        publishing = true;
        const complete = (rejected: boolean, failure?: unknown) => {
            publishing = false;
            if (rejected && !primaryPresent)
                first(failure);
            if (pendingContinuations)
                return;
            published = true;
            physicalKnown = !rejected && !unknown;
            finishPhysical();
            if (primaryPresent)
                no(primary);
            else if (!physicalKnown)
                no(Error('controller_ipc_physical_unknown'));
            else
                yes(result!);
        };
        const join = stock.waitPhysicalKnown();
        keep(join);
        const observer = ipcApply(ipcThen, join, [
            () => complete(false), (failure: unknown) => complete(true, failure),
        ]) as Promise<unknown>;
        ipcDefine(observer, 'constructor', { __proto__: null, value: IpcPromise } as PropertyDescriptor);
        keep(observer);
        keep(ipcApply(ipcThen, observer, [undefined, (failure: unknown) => {
                first(failure);
                opaque();
                complete(true, failure);
            }]));
    }
    const socketConsumer = async () => {
        if (!socketClosed)
            throw Error('controller_ipc_physical_unknown');
    };
    const lifetimeConsumer = () => undefined;
    const peerConsumer = () => undefined;
    let peerOwned = false;
    const timerConsumer = () => {
        const raw = clearTimeout(timer);
        keep(raw);
        return raw;
    };
    // Resolve data methods inside the pre-reserved SDK root. A late accessor
    // cannot run before reservation or turn an unknown resource into a send.
    const invokeMethod = <T>(receiver: object, name: PropertyKey, args: unknown[], sending = false): Promise<T> => stock.consumeResource<T>(function () {
        if (sending)
            current();
        let node: object | null = receiver, method: Function | undefined;
        for (let depth = 0; node && depth < 128; depth++) {
            if (ipcTypes.isProxy(node)) {
                opaque();
                throw Error('controller_ipc_physical_unknown');
            }
            const row = Object.getOwnPropertyDescriptor(node, name);
            if (row) {
                if (!Object.hasOwn(row, 'value') || typeof row.value !== 'function' || ipcTypes.isProxy(row.value)) {
                    opaque();
                    throw Error('controller_ipc_physical_unknown');
                }
                method = row.value;
                break;
            }
            node = Object.getPrototypeOf(node);
        }
        if (!method) {
            opaque();
            throw Error('controller_ipc_physical_unknown');
        }
        ipcDefine(lifetime, 'method' + resourceSequence++, { __proto__: null, value: method } as PropertyDescriptor);
        if (sending)
            current();
        const raw = ipcApply(method, receiver, args);
        keep(raw);
        // A fluent self-return is the exact resource already held by this stock.
        return raw === socket ? undefined : raw;
    }, receiver === socket ? socket! : lifetime, []);
    const watch = (raw: Promise<unknown>) => {
        keep(raw);
        then(raw, () => undefined, error => { finish(true, error); });
    };
    const current = () => {
        if (sealed || signal?.aborted || process.hrtime.bigint() >= expiresAt)
            throw Error('controller_ipc_timeout_unknown');
        stock.local();
    };
    const callback = (work: () => unknown) => {
        const raw = stock.consumeResource(() => {
            const outcome = work();
            keep(outcome);
            return outcome;
        }, socket ?? lifetime, []);
        watch(raw);
    };
    const abort = (event?: Event) => callback(async () => {
        // Stop future writes synchronously, before awaiting the original Event's
        // visible SDK tails. The Event is a resource observation, never authority.
        finish(true, Error('controller_ipc_aborted_unknown'));
        if (event === undefined)
            return;
        const consumeEvent = () => undefined;
        try {
            await stock.sdk(() => event, undefined, [], {
                accept(value) {
                    if (value !== event || ipcTypes.isProxy(value))
                        return false;
                    ipcApply(ipcEventPhase, value, []);
                    return true;
                },
                consumer: consumeEvent, strictProxyGraph: true,
            });
        }
        catch (failure) {
            first(failure);
            opaque();
        }
        finally {
            try {
                await stock.consumeResource(consumeEvent, event, []);
            }
            catch (failure) {
                first(failure);
                opaque();
            }
        }
    });
    function finish(rejected: boolean, error?: unknown, value?: Buffer): void {
        if (rejected)
            first(error);
        if (sealed)
            return;
        if (!rejected && process.hrtime.bigint() >= expiresAt)
            first(Error('controller_ipc_timeout_unknown'));
        sealed = true;
        result = value;
        bytes = Buffer.alloc(0);
        cleanup = then(new IpcPromise<void>(resolve => resolve()), async () => {
            // Every independent negative operation is attempted, even after another
            // cleanup throws. A thrown cleanup is not evidence it never entered.
            if (timer) {
                try {
                    await stock.consumeResource(timerConsumer, timer, []);
                }
                catch (failure) {
                    first(failure);
                    opaque();
                }
            }
            if (abortInstalled && signal) {
                try {
                    await invokeMethod(signal, 'removeEventListener', ['abort', abort]);
                }
                catch (failure) {
                    first(failure);
                    opaque();
                }
            }
            if (socket) {
                let destructionKnown = false;
                try {
                    await invokeMethod(socket, 'destroy', []);
                    destructionKnown = true;
                }
                catch (failure) {
                    first(failure);
                    opaque();
                }
                if (destructionKnown)
                    await closed;
                if (socketClosed) {
                    try {
                        await stock.consumeResource(socketConsumer, socket, []);
                    }
                    catch (failure) {
                        first(failure);
                        opaque();
                    }
                }
            }
            else if (constructorEntered)
                opaque();
            if (peerOwned && verifyServerPeer) {
                try {
                    await stock.consumeResource(peerConsumer, peerResource, []);
                }
                catch (failure) {
                    first(failure);
                    opaque();
                }
            }
            try {
                await stock.consumeResource(lifetimeConsumer, lifetime, []);
            }
            catch (failure) {
                first(failure);
                opaque();
            }
            stock.seal();
            cleanupFinished = true;
        }, failure => { first(failure); opaque(); throw failure; }) as Promise<void>;
        then(cleanup, () => undefined, failure => {
            first(failure);
            opaque();
            cleanupFinished = true;
        });
    }
    const view = Object.freeze({
        async waitKnown(): Promise<void> {
            // The operation remains active until its own ordinary finish is reached.
            await physicalFinished;
            if (cleanup)
                await cleanup;
            if (!cleanupFinished || !physicalKnown)
                throw Error('controller_ipc_physical_unknown');
            stock.assertPhysicalKnown();
        },
        assertKnown(): void {
            if (!cleanupFinished || !physicalKnown)
                throw Error('controller_ipc_physical_unknown');
            stock.assertPhysicalKnown();
        },
    });
    ipcApply(ipcSet, ipcCalls, [originalCall, view]);
    const birth = stock.sdk(() => lifetime, undefined, [], {
        accept: value => value === lifetime, consumer: lifetimeConsumer,
    });
    then(birth, () => {
        const preparePeer = verifyServerPeer ? stock.sdk(() => peerResource, undefined, [], {
            accept: value => value === peerResource, consumer: peerConsumer,
        }) : new IpcPromise<void>(resolve => resolve());
        then(preparePeer, () => {
            peerOwned = !!verifyServerPeer;
            const acquisition = stock.sdk<Socket>(() => {
                constructorEntered = true;
                const acquired = originalConnection(socketPath);
                socket = acquired;
                keep(acquired);
                return acquired;
            }, undefined, [], {
                accept: value => !!socket && value === socket,
                consumer: socketConsumer,
            });
            then(acquisition, () => {
                if (!socket) {
                    opaque();
                    finish(true, Error('controller_ipc_physical_unknown'));
                    return;
                }
                const listen = (name: string, listener: (...args: any[]) => void) => watch(invokeMethod(socket!, 'on', [name, listener]));
                listen('error', (error: unknown) => callback(() => finish(true, error)));
                listen('close', () => {
                    socketClosed = true;
                    closeSocket();
                    callback(() => {
                        if (!sealed)
                            finish(true, Error('controller_ipc_closed_unknown'));
                    });
                });
                listen('connect', () => callback(async () => {
                    if (sealed)
                        return;
                    try {
                        if (verifyServerPeer) {
                            // A peer verifier must remain synchronously void. Its original
                            // nonvoid Promise is still inventoried and drained, never trusted.
                            let returned: unknown;
                            const call = stock.consumeResource(() => {
                                returned = verifyServerPeer(socket!);
                                keep(returned);
                                return returned;
                            }, socket!, []);
                            // Its immediate return is checked without assimilating foreign raw.
                            watch(call);
                            if (returned !== undefined)
                                throw Error('controller_server_peer_sync_void');
                            await call;
                        }
                        current();
                        const write = invokeMethod(socket!, 'write', [request], true);
                        await write;
                    }
                    catch (failure) {
                        finish(true, failure);
                    }
                }));
                listen('data', (chunk: Buffer) => callback(async () => {
                    try {
                        // Even a sealed/failed operation owns actual SDK callback
                        // arguments. The existing private lifetime resource scans
                        // their data/symbol graph without granting new effects.
                        if (ipcTypes.isProxy(chunk) || !Buffer.isBuffer(chunk)) {
                            inventory(chunk);
                            opaque();
                            throw Error('controller_ipc_physical_unknown');
                        }
                        keep(chunk);
                        const slot = 'chunk' + resourceSequence++;
                        ipcDefine(lifetime, slot, { __proto__: null, value: chunk, configurable: true } as PropertyDescriptor);
                        let scan: Promise<unknown>;
                        try {
                            scan = stock.consumeResource(() => undefined, lifetime, []);
                        }
                        finally {
                            Reflect.deleteProperty(lifetime, slot);
                        }
                        // The fixed consumer scans synchronously at both sides.
                        // Its Promise/outcome tails remain in the original stock;
                        // deleting our projection cannot delete those held tails.
                        await scan;
                        if (!sealed) {
                            if (bytes.length + chunk.length > maximumBytes + 4)
                                finish(true, Error('controller_ipc_frame_limit'));
                            else {
                                bytes = Buffer.concat([bytes, chunk]);
                                if (bytes.length >= 4) {
                                    const size = bytes.readUInt32BE(0);
                                    if (size > maximumBytes || bytes.length > size + 4)
                                        finish(true, Error('controller_ipc_frame_limit'));
                                    else if (bytes.length === size + 4)
                                        finish(false, undefined, bytes.subarray(4));
                                }
                            }
                        }
                    }
                    catch (failure) {
                        finish(true, failure);
                    }
                }));
                const timerBirth = stock.sdk<ReturnType<typeof setTimeout>>(() => {
                    timerEntered = true;
                    timer = setTimeout(() => callback(() => finish(true, Error('controller_ipc_timeout_unknown'))), delay);
                    return timer;
                }, undefined, [], {
                    accept: value => value === timer, consumer: timerConsumer,
                });
                then(timerBirth, () => undefined, failure => {
                    if (timerEntered && !timer)
                        opaque();
                    finish(true, failure);
                });
                if (signal) {
                    // Reserve removal before add: addEventListener itself can synchronously
                    // reenter abort/finish and then throw before returning its raw value.
                    abortInstalled = true;
                    watch(invokeMethod(signal, 'addEventListener', ['abort', abort, { once: true }]));
                    if (signal.aborted)
                        abort();
                }
            }, error => {
                if (!socket)
                    opaque();
                finish(true, error);
            });
        }, error => { peerOwned = !!verifyServerPeer; finish(true, error); });
    }, error => { opaque(); finish(true, error); });
    return originalCall;
}
