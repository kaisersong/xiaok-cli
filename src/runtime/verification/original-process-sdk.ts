import {readOriginalCompletionFileOperation} from '../guards/original-completion-file-io.js';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { OriginalHostWorkerRequest } from '../task-host/original-host-worker-types.js';
import { readOptionalOriginalTaskHostDeliveryWorkerRequest } from '../task-host/task-runtime-host.js';
import { readOptionalOriginalTaskStoreProtectionWorkerRequest } from '../task-host/snapshot-store.js';
import { spawn, spawnSync, ChildProcess, type SpawnOptions, type SpawnSyncOptions } from 'node:child_process';
import { Worker, type WorkerOptions } from 'node:worker_threads';
import { EventEmitter } from 'node:events';
import { Readable, Writable } from 'node:stream';
import { ORIGINAL_BOUNDED_GLOB_WORKER_ENTRY } from '../../ai/tools/original-glob-worker-source.js';
import { createHash, Hash } from 'node:crypto';
import { types } from 'node:util';
import { readCurrentOriginalTaskRunnerResourceContext } from '../task-host/task-runtime-host.js';
import { readCurrentOriginalToolProcessAuthorization, assertOriginalToolProcessAuthorizationCurrent, assertOriginalToolProcessAuthorizationLocal } from '../../ai/tools/index.js';
import { hasOriginalMainSdkBridgeInstallation, readOptionalOriginalMainSdkBridge, readOptionalOriginalMainProcessSourceRequest, type OriginalMainSdkPhysicalBridge } from './original-main-sdk-bridge.js';
import type {OriginalProcessSourceRequest} from './original-process-source-types.js';
import { createRoomTurnCustody, type RoomTurnCustody } from './original-sdk-custody.js';
import { createIntrinsicSet, appendIntrinsic, settleIntrinsicOperations } from './intrinsic-async-collection.js';
import { captureDispatchBusinessData } from '../conversation-activity/dispatch-business-data.js';
const apply = Reflect.apply, define = Object.defineProperty, create = Object.create, freeze = Object.freeze;
const descriptor = Object.getOwnPropertyDescriptor, keys = Reflect.ownKeys, own = Object.hasOwn, prototype = Object.getPrototypeOf;
const assign = Object.assign, json = JSON.stringify, parseJson = JSON.parse, isArray = Array.isArray, nativeSort = Array.prototype.sort;
const safeInteger = Number.isSafeInteger;
const get = WeakMap.prototype.get, set = WeakMap.prototype.set, isProxy = types.isProxy, isPromise = types.isPromise;
const NativePromise = Promise, nativeThen = Promise.prototype.then, NativeError = Error, NativeWorker = Worker;
const nativeSpawn = spawn, nativeSpawnSync = spawnSync, nativeOn = EventEmitter.prototype.on, nativeOff = EventEmitter.prototype.removeListener;
const readableOn = Readable.prototype.on;
const nativeEnd = Writable.prototype.end;
const abortSignalAborted = descriptor(AbortSignal.prototype, 'aborted')!.get!;
const abortSignalThrow = AbortSignal.prototype.throwIfAborted;
const addEvent = EventTarget.prototype.addEventListener, removeEvent = EventTarget.prototype.removeEventListener;
const nativeKill = ChildProcess.prototype.kill, nativeTerminate = Worker.prototype.terminate, nativePost = Worker.prototype.postMessage;
const bufferFrom = Buffer.from, bufferToString = Buffer.prototype.toString;
const hostWorkerScope = new AsyncLocalStorage<object>(), hostWorkerGet = AsyncLocalStorage.prototype.getStore, hostWorkerRun = AsyncLocalStorage.prototype.run;
const hostWorkerOnce = new WeakMap<object, Row>();
const sourceOnce = new WeakMap<object, Row>();
let synchronousHostWorkerTicket: object | undefined;
const hashUpdate = Hash.prototype.update, hashDigest = Hash.prototype.digest;
const urlHref = descriptor(URL.prototype, 'href')!.get!;
const childProcessPrototype = ChildProcess.prototype, workerPrototype = NativeWorker.prototype;
const workerStreams = { stdout: descriptor(workerPrototype, 'stdout')!.get!, stderr: descriptor(workerPrototype, 'stderr')!.get!, stdin: descriptor(workerPrototype, 'stdin')!.get! };
type Endpoint = 'child' | 'stdout' | 'stderr' | 'stdin';
interface Handler {
    endpoint: Endpoint;
    event: string;
    fn: Function;
}
interface Frame {
    endpoint: Endpoint;
    event: string;
    args: unknown[];
}
interface Row {
    context: object | null;
    authorization: object | null;
    bridge: OriginalMainSdkPhysicalBridge | null;
    id: string;
    hash: string;
    permit?: object;
    consumeEntered: boolean;
    constructEntered: boolean;
    handle?: ChildProcess | Worker;
    originalPid?: number;
    kernelObservationFailed?: boolean;
    stocks: RoomTurnCustody[];
    raws: ReturnType<typeof createIntrinsicSet<unknown>>;
    refs: ReturnType<typeof createIntrinsicSet<object>>;
    streams: Partial<Record<Endpoint, NodeJS.EventEmitter>>;
    handlers: Handler[];
    frames: Frame[];
    listenersOpen: boolean;
    terminal: boolean;
    spawned: boolean;
    errorSeen: boolean;
    dispatching: number;
    checking: boolean;
    finished: boolean;
    unknown: boolean;
    physicalKnown: boolean;
    prefixStocks?: RoomTurnCustody[];
    stdio: ReturnType<typeof createIntrinsicSet<string>>;
    stdioDone: ReturnType<typeof createIntrinsicSet<string>>;
    failurePresent: boolean;
    failure: unknown;
    receipt: object;
    completion: Promise<object>;
    yes(receipt: object): void;
    no(error: unknown): void;
    hostTicket?: object;
    hostRequest?: Readonly<OriginalHostWorkerRequest>;
    sourceTicket?: object;
    sourceRequest?: OriginalProcessSourceRequest;
    hostMessageSent: boolean;
    acquireEntered: boolean;
    acquireRaw?: object;
    domainKnown: boolean;
    kind: 'process' | 'worker' | 'sync' | 'readonly_leaf';
    attempt: object;
}
const attempts = new WeakMap<object, Row>(), receipts = new WeakMap<object, Row>(), active = createIntrinsicSet<Row>();
let sequence = 0;
function denied(code = 'TOOL_PROCESS_SDK_UNCONFIRMED'): never { throw new NativeError(code); }
function internal<T>(promise: Promise<T>): Promise<T> { define(promise, 'constructor', { __proto__: null, value: NativePromise } as PropertyDescriptor); return promise; }
function box<T extends object>(value: T): T { return freeze(assign(create(null), value)); }
function rowOf(attempt: unknown): Row {
    const row = apply(get, attempts, [attempt]) as Row | undefined;
    if (!row)
        denied('TOOL_PROCESS_ORIGINAL_ATTEMPT_REQUIRED');
    return row;
}
function remember(row: Row, error: unknown): void {
    if (!row.failurePresent) {
        row.failurePresent = true;
        row.failure = error;
    }
    row.raws.add(error);
}
function stock(row: Row): RoomTurnCustody { const value = createRoomTurnCustody(); appendIntrinsic(row.stocks, value); return value; }
function inspectRefs(row: Row, root: unknown): void {
    const seen = createIntrinsicSet<object>(), work: unknown[] = [root];
    for (let i = 0; i < work.length; i++) {
        const value = work[i];
        if (value === null || typeof value !== 'object' && typeof value !== 'function' || seen.has(value as object))
            continue;
        seen.add(value as object);
        row.raws.add(value);
        if (isPromise(value) && !isProxy(value))
            continue;
        row.refs.add(value as object);
        if (isProxy(value)) {
            row.unknown = true;
            continue;
        }
        if (work.length > 65536) {
            row.unknown = true;
            return;
        }
        const names = keys(value);
        for (let j = 0; j < names.length; j++) {
            const key = names[j]!, field = descriptor(value, key);
            if (!field || !own(field, 'value'))
                continue;
            if (isPromise(value) && key === 'constructor' && field.value === NativePromise)
                continue;
            if (field.value !== null && (typeof field.value === 'object' || typeof field.value === 'function'))
                appendIntrinsic(work, field.value);
        }
    }
}
function consumeMetadata(): void { }
async function metadata(row: Row, value: unknown): Promise<void> {
    const custody = stock(row);
    row.raws.add(value);
    inspectRefs(row, value);
    // The function/foreign SDK value is data inside this null-prototype shell,
    // never a Promise-resolution value. This also keeps own then accessors inert.
    const shell = box({ value });
    const raw = await custody.sdk<object>(() => shell, undefined, [], { accept: v => v === shell, consumer: consumeMetadata, strictProxyGraph: row.kind === 'readonly_leaf' });
    await custody.consumeResource(consumeMetadata, raw, []);
}
function current(row: Row): void {
    if (row.sourceRequest) {
        stock(row).syncVoid(row.sourceRequest.assertCurrent, undefined, []);
        if (row.permit) row.bridge!.assertProcessCurrent(row.permit);
        stock(row).syncVoid(row.sourceRequest.assertLocal, undefined, []);
        return;
    }
    if (row.hostRequest) {
        row.hostRequest.assertCurrent();
        if (row.permit)
            row.bridge!.assertProcessCurrent(row.permit);
        row.hostRequest.assertLocal();
        return;
    }
    if (row.bridge) {
        if (!row.context || !row.authorization)
            denied('TOOL_PROCESS_ORIGINAL_AUTHORIZATION_REQUIRED');
        assertOriginalToolProcessAuthorizationCurrent(row.authorization);
        if (row.permit)
            row.bridge.assertProcessCurrent(row.permit);
        assertOriginalToolProcessAuthorizationCurrent(row.authorization);
    }
}
function initial(kind: Row['kind']): Row {
    let yes!: (receipt: object) => void, no!: (error: unknown) => void;
    const completion = internal(new NativePromise<object>((resolve, reject) => { yes = resolve; no = reject; }));
    // Observe the private rejection before any SDK can reenter. The original
    // completion remains held and is returned unchanged to the fixed consumer.
    apply(nativeThen, completion, [() => { }, () => { }]);
    const row: Row = {
        context: null, authorization: null, bridge: null, id: 'tool-sdk:' + String(++sequence), hash: '', consumeEntered: false, constructEntered: false, stocks: [], raws: createIntrinsicSet(), refs: createIntrinsicSet(), streams: create(null), handlers: [], frames: [], listenersOpen: true, terminal: false, spawned: false, errorSeen: false, dispatching: 0, checking: false, finished: false, unknown: false, physicalKnown: false, stdio: createIntrinsicSet(), stdioDone: createIntrinsicSet(), hostMessageSent: false, acquireEntered: false, domainKnown: false, failurePresent: false, failure: undefined, receipt: freeze(create(null)), completion, yes, no, kind, attempt: freeze(create(null))
    };
    active.add(row);
    apply(set, attempts, [row.attempt, row]);
    apply(set, receipts, [row.receipt, row]);
    return row;
}
function canonical(value: unknown): string {
    if (value === null || typeof value !== 'object')
        return json(value);
    if (isArray(value)) {
        let out = '[';
        for (let i = 0; i < value.length; i++)
            out += (i ? ',' : '') + canonical(value[i]);
        return out + ']';
    }
    const names = keys(value);
    apply(nativeSort, names, []);
    let out = '{';
    for (let i = 0; i < names.length; i++) {
        const name = names[i] as string;
        out += (i ? ',' : '') + json(name) + ':' + canonical((value as Record<string, unknown>)[name]);
    }
    return out + '}';
}
function digest(value: unknown): string {
    const hash = createHash('sha256');
    apply(hashUpdate, hash, ['["original-process-spec-v1",' + canonical(value) + ']']);
    return apply(hashDigest, hash, ['hex']) as string;
}
async function reserve<T>(row: Row, spec: T): Promise<T> {
    const scope = stock(row);
    let captured!: T;
    await scope.root(async () => {
        captured = captureDispatchBusinessData(spec, raw => scope.inventory(raw), true) as T;
        row.bridge = readOptionalOriginalMainSdkBridge();
        row.context = row.sourceRequest?.context ?? row.hostTicket ?? readCurrentOriginalTaskRunnerResourceContext();
        row.authorization = row.hostTicket || row.sourceTicket ? null : readCurrentOriginalToolProcessAuthorization();
        if ((row.hostTicket || row.sourceTicket) && !row.bridge)
            denied('TOOL_PROCESS_ORIGINAL_MAIN_BRIDGE_REQUIRED');
        row.hash = row.sourceRequest?.specHash ?? digest(captured);
        if (row.sourceRequest) row.id = row.sourceRequest.invocationId;
        current(row);
        if (row.bridge) {
            row.acquireEntered = true;
            row.permit = await scope.sdk<object>(() => { const raw = row.bridge!.acquireProcess(row.context!, row.id, row.hash); row.raws.add(raw); row.acquireRaw = raw; return raw; }, undefined, []);
            current(row);
        }
    });
    return captured;
}
function enter(row: Row): void {
    current(row);
    if (row.bridge) {
        row.bridge.assertProcessLocal(row.permit!);
        if (row.sourceRequest)
            stock(row).syncVoid(row.sourceRequest.assertLocal, undefined, []);
        else if (row.hostRequest)
            row.hostRequest.assertLocal();
        else
            assertOriginalToolProcessAuthorizationLocal(row.authorization);
        row.consumeEntered = true;
        row.bridge.consumeProcess(row.permit!);
        // consume's fixed bridge performs a real Native verification. A
        // synchronous SDK wrapper can revoke the original Source at that cut.
        // Repeat only pure local gates before the actual constructor begins.
        row.bridge.assertProcessLocal(row.permit!);
        if (row.sourceRequest)
            stock(row).syncVoid(row.sourceRequest.assertLocal, undefined, []);
        else if (row.hostRequest)
            stock(row).syncVoid(row.hostRequest.assertLocal, undefined, []);
        else
            assertOriginalToolProcessAuthorizationLocal(row.authorization);
    }
    row.constructEntered = true;
}
function dispatch(row: Row, frame: Frame): void {
    row.raws.add(frame.args);
    inspectRefs(row, frame.args);
    row.dispatching++;
    try {
        const handlers = row.handlers;
        for (let i = 0; i < handlers.length; i++) {
            const handler = handlers[i]!;
            if (handler.endpoint !== frame.endpoint || handler.event !== frame.event)
                continue;
            const custody = stock(row);
            const raw = custody.root(async () => {
                const argsInspection = metadata(row, frame.args), functionInspection = metadata(row, handler.fn);
                const callback = custody.sdk(handler.fn, undefined, frame.args);
                // Invoke the original event callback in the actual synchronous delivery.
                // Its raw is owned before any inspection continuation can settle/reject.
                apply(nativeThen, callback, [() => { }, () => { }]);
                const afterInspection = metadata(row, handler.fn);
                await argsInspection;
                await functionInspection;
                await afterInspection;
                await callback;
            });
            row.raws.add(raw);
            apply(nativeThen, raw, [() => check(row), (error: unknown) => { remember(row, error); check(row); }]);
        }
    }
    finally {
        row.dispatching--;
        check(row);
    }
}
function event(row: Row, endpoint: Endpoint, name: string, args: unknown[]): void {
    if (name === 'spawn')
        row.spawned = true;
    if (endpoint !== 'child' && (name === 'end' || name === 'close' || name === 'finish'))
        row.stdioDone.add(endpoint);
    if (name === 'error') {
        row.errorSeen = true;
        remember(row, args[0]);
        stock(row).inventory(args[0]);
    }
    if (endpoint === 'child' && (name === 'close' && row.kind === 'process' || name === 'exit' && row.kind === 'worker'))
        row.terminal = true;
    if (row.listenersOpen) {
        if (row.frames.length >= 1024) {
            row.unknown = true;
            return;
        }
        appendIntrinsic(row.frames, { endpoint, event: name, args });
        row.raws.add(args);
        inspectRefs(row, args);
    }
    else
        dispatch(row, { endpoint, event: name, args });
    check(row);
}
function registerListener(row: Row, emitter: object, method: Function, name: string, listener: Function): void {
    const custody = stock(row);
    const raw = custody.sdk<object>(() => {
        const returned = apply(method, emitter, [name, listener]);
        row.raws.add(returned);
        return box({ returned });
    }, undefined, [], { accept: value => !!value && typeof value === 'object' && !isProxy(value), consumer: consumeMetadata });
    row.raws.add(raw);
    const observer = apply(nativeThen, raw, [value => custody.consumeResource(consumeMetadata, value, []), (error: unknown) => { remember(row, error); row.unknown = true; check(row); }]);
    row.raws.add(observer);
    apply(nativeThen, observer, [() => check(row), (error: unknown) => { remember(row, error); row.unknown = true; check(row); }]);
}
function attach(row: Row): void {
    const handle = row.handle!;
    if (row.kind === 'process') {
        const pid = descriptor(handle, 'pid');
        if (pid && own(pid, 'value') && typeof pid.value === 'number' && safeInteger(pid.value) && pid.value > 0)
            row.originalPid = pid.value;
    }
    const names = row.kind === 'worker' ? ['online', 'message', 'messageerror', 'error', 'exit'] : ['spawn', 'error', 'exit', 'close', 'disconnect'];
    for (let i = 0; i < names.length; i++) {
        const name = names[i]!;
        registerListener(row, handle, nativeOn, name, (...args: unknown[]) => event(row, 'child', name, args));
    }
    for (const endpoint of ['stdout', 'stderr', 'stdin'] as const) {
        const found = row.kind === 'worker' ? apply(workerStreams[endpoint], handle, []) : descriptor(handle, endpoint);
        const stream = (row.kind === 'worker' ? found : found && own(found, 'value') ? found.value : undefined) as NodeJS.EventEmitter | undefined;
        row.raws.add(stream);
        if (!stream)
            continue;
        row.streams[endpoint] = stream;
        row.stdio.add(endpoint);
        for (const name of ['error', 'end', 'close', 'finish'])
            registerListener(row, stream, nativeOn, name, (...args: unknown[]) => event(row, endpoint, name, args));
    }
}
function check(row: Row): void {
    if (!row.terminal || row.listenersOpen || row.dispatching || row.checking || row.finished)
        return;
    if (row.kind === 'worker') {
        const endpoints = row.stdio.snapshot();
        for (let i = 0; i < endpoints.length; i++)
            if (!row.stdioDone.has(endpoints[i]!))
                return;
    }
    row.checking = true;
    const raw = internal((async () => {
        try {
            // Retain every SDK resource that was actually acquired, including references
            // Node removed from its handle at close. Rescan after callback outcomes.
            const resources = row.refs.snapshot();
            for (let i = 0; i < resources.length; i++)
                await metadata(row, resources[i]!);
            let offset = 0;
            while (offset < row.stocks.length) {
                const batch = row.stocks.slice(offset);
                offset = row.stocks.length;
                const results = await settleIntrinsicOperations(batch, value => value.waitPhysicalKnown());
                for (let i = 0; i < results.length; i++)
                    if (results[i]!.status === 'rejected') {
                        row.unknown = true;
                        remember(row, (results[i] as PromiseRejectedResult).reason);
                    }
            }
            if (row.unknown)
                denied();
            row.prefixStocks = row.stocks.slice();
            row.physicalKnown = true;
            if (row.bridge) {
                const cleanup = stock(row);
                await cleanup.sdk(row.bridge.settleProcess, row.bridge, [row.permit, row.receipt]);
                await cleanup.waitPhysicalKnown();
            }
            row.finished = true;
            active.delete(row);
            if (row.failurePresent)
                row.no(row.failure);
            else
                row.yes(row.receipt);
        }
        catch (error) {
            remember(row, error);
            row.unknown = true;
            row.no(row.failurePresent ? row.failure : error);
        }
        finally {
            row.checking = false;
        }
    })());
    row.raws.add(raw);
    apply(nativeThen, raw, [() => { }, (error: unknown) => { remember(row, error); row.unknown = true; row.no(row.failurePresent ? row.failure : error); }]);
}
async function failedEntry(row: Row, error: unknown): Promise<never> {
    remember(row, error);
    stock(row).inventory(error);
    // A failed Source cut can itself have accepted raw children before the
    // process constructor. Do not let Registry error formatting hide those tails
    // from the original Host invocation, or cancel its P before they are known.
    if (!row.constructEntered) {
        let offset = 0;
        while (offset < row.stocks.length) {
            const batch = row.stocks.slice(offset);
            offset = row.stocks.length;
            const results = await settleIntrinsicOperations(batch, value => value.waitPhysicalKnown());
            for (let i = 0; i < results.length; i++)
                if (results[i]!.status === 'rejected') {
                    row.unknown = true;
                    remember(row, (results[i] as PromiseRejectedResult).reason);
                }
        }
        if (row.unknown)
            return await internal(new NativePromise<never>(() => { }));
    }
    if (row.bridge && row.acquireEntered && !row.permit) {
        // Only the original Owner's private acquire-raw membership can confirm its
        // negative fate. Rejection/result absence never substitutes for that fact.
        if (!row.acquireRaw) {
            row.unknown = true;
            row.no(error);
            throw error;
        }
        try {
            const cleanup = stock(row);
            await cleanup.sdk(row.bridge.cancelProcess, row.bridge, [row.acquireRaw]);
            await cleanup.waitPhysicalKnown();
        }
        catch (failure) {
            remember(row, failure);
            row.unknown = true;
            row.no(error);
            throw error;
        }
    }
    if (row.bridge && row.permit && row.consumeEntered && !row.constructEntered) {
        // The fixed consume wrapper may fail before the Owner burns its permit,
        // or after its private one-use cut. Ask the original negative port first;
        // never infer either state from an exception or a missing SDK handle.
        const cleanup = stock(row);
        let cancelled = false;
        try {
            await cleanup.sdk(row.bridge.cancelProcess, row.bridge, [row.permit]);
            cancelled = true;
        }
        catch (failure) {
            remember(row, failure);
        }
        try {
            await cleanup.waitPhysicalKnown();
        }
        catch (failure) {
            remember(row, failure);
            row.unknown = true;
        }
        if (cancelled && !row.unknown) {
            row.prefixStocks = row.stocks.slice();
            row.physicalKnown = true;
            row.terminal = true;
            row.listenersOpen = false;
            row.finished = true;
            active.delete(row);
            row.no(error);
            throw error;
        }
        if (row.unknown) {
            row.no(error);
            throw error;
        }
        // A genuine consumed permit can only finish through its exact private
        // known-not-started receipt. Completion rejects the first cause AFTER
        // its complete stocks and the original C negative settlement finish.
        row.terminal = true;
        row.listenersOpen = false;
        check(row);
        await row.completion;
        throw error;
    }
    if (row.bridge && row.permit && !row.consumeEntered) {
        try {
            const cleanup = stock(row);
            await cleanup.sdk(row.bridge.cancelProcess, row.bridge, [row.permit]);
            await cleanup.waitPhysicalKnown();
        }
        catch (failure) {
            remember(row, failure);
            row.unknown = true;
        }
    }
    else if (row.constructEntered)
        row.unknown = true;
    else if (row.consumeEntered) {
        row.terminal = true;
        row.listenersOpen = false;
        check(row);
    }
    if (!row.constructEntered && !row.consumeEntered && !row.unknown) {
        row.prefixStocks = row.stocks.slice();
        row.physicalKnown = true;
        row.finished = true;
        active.delete(row);
    }
    row.no(error);
    throw error;
}
export async function spawnOriginalToolProcess(command: string, argv: readonly string[], options: SpawnOptions): Promise<Readonly<{
    handle: ChildProcess;
    attempt: object;
}>> {
    const row = initial('process');
    try {
        const spec = await reserve(row, {
            kind: 'spawn', command, argv, options
        });
        enter(row);
        const custody = stock(row);
        const handle = await custody.sdk<ChildProcess>(() => {
            const value = nativeSpawn(spec.command, spec.argv as string[], spec.options);
            row.raws.add(value);
            row.handle = value;
            if (isProxy(value) || prototype(value) !== childProcessPrototype)
                denied();
            attach(row);
            return value;
        }, undefined, [], { accept: v => v === row.handle, consumer: consumeMetadata });
        await custody.consumeResource(consumeMetadata, handle, []);
        inspectRefs(row, handle);
        return box({ handle, attempt: row.attempt });
    }
    catch (error) {
        return failedEntry(row, error);
    }
}
/** No command/options/context are accepted from this caller. The one pinned
 * Main Owner first recognizes an original producer ticket and fixes its spec. */
async function createSourceResource(ticket: unknown, operation: 'spawn' | 'worker'): Promise<Readonly<{handle: ChildProcess | Worker; attempt: object}>> {
    const row = initial(operation === 'spawn' ? 'process' : 'worker');
    try {
        row.raws.add(ticket);
        let request: OriginalProcessSourceRequest | null = null;
        stock(row).syncVoid(() => {
            request = readOptionalOriginalMainProcessSourceRequest(ticket);
            row.raws.add(request);
            if (!ticket || typeof ticket !== 'object' || isProxy(ticket) || !request || typeof request !== 'object' || isProxy(request))
                denied('TOOL_PROCESS_ORIGINAL_SOURCE_REQUIRED');
            if (apply(get, sourceOnce, [ticket])) denied('TOOL_PROCESS_SOURCE_ALREADY_ENTERED');
            // Reserve before current/role/acquire SDK. Failure never remints it.
            apply(set, sourceOnce, [ticket, row]);
            row.sourceTicket = ticket;
            row.sourceRequest = request;
            if (request.operation !== operation || request.kind !== 'original_process_source_request_v1')
                denied('TOOL_PROCESS_ORIGINAL_SOURCE_REQUIRED');
            // New Source families provide component facts until their actual
            // whole-domain protocol has independently been qualified.
            if (request.domain !== 'component_only' && !(request.sourceKind === 'workflow_vm' && request.operation === 'worker' && request.domain === 'sealed_worker')) denied('TOOL_PROCESS_SOURCE_DOMAIN_UNCONFIRMED');
            row.domainKnown = request.sourceKind === 'workflow_vm' && request.operation === 'worker' && request.domain === 'sealed_worker';
        }, undefined, []);
        const fixed = row.sourceRequest!;
        const rawSpec = fixed.operation === 'spawn'
            ? {kind: 'spawn', command: fixed.command, argv: fixed.argv, options: fixed.options}
            : {kind: 'worker', entry: fixed.entry, options: fixed.options};
        const spec = await reserve(row, rawSpec);
        enter(row);
        const custody = stock(row);
        const handle = await custody.sdk<ChildProcess | Worker>(() => {
            const value = spec.kind === 'spawn'
                ? nativeSpawn(spec.command!, spec.argv as string[], spec.options as SpawnOptions)
                : new NativeWorker(spec.entry!, spec.options as WorkerOptions);
            row.raws.add(value);
            row.handle = value;
            if (isProxy(value) || prototype(value) !== (operation === 'spawn' ? childProcessPrototype : workerPrototype)) denied();
            attach(row);
            return value;
        }, undefined, [], {accept: value => value === row.handle, consumer: consumeMetadata});
        await custody.consumeResource(consumeMetadata, handle, []);
        inspectRefs(row, handle);
        return box({handle, attempt: row.attempt});
    } catch (error) {return failedEntry(row, error);}
}
export async function createOriginalSourceProcess(ticket: unknown): Promise<Readonly<{handle: ChildProcess; attempt: object}>> {
    return await createSourceResource(ticket, 'spawn') as Readonly<{handle: ChildProcess; attempt: object}>;
}
export async function createOriginalSourceWorker(ticket: unknown): Promise<Readonly<{handle: Worker; attempt: object}>> {
    return await createSourceResource(ticket, 'worker') as Readonly<{handle: Worker; attempt: object}>;
}
/** Only the fixed original readonly producer may use this P-only path. */
export async function createOriginalHostWorker(ticket: unknown): Promise<Readonly<{
    handle: Worker;
    attempt: object;
}>> {
    const row = initial('worker');
    try {
        row.raws.add(ticket);
        const request = readOptionalOriginalTaskHostDeliveryWorkerRequest(ticket) ?? readOptionalOriginalTaskStoreProtectionWorkerRequest(ticket);
        if (!request || !ticket || typeof ticket !== 'object' || isProxy(ticket))
            denied('TOOL_PROCESS_ORIGINAL_HOST_WORKER_REQUIRED');
        if (apply(get, hostWorkerOnce, [ticket]))
            denied('TOOL_PROCESS_HOST_WORKER_ALREADY_ENTERED');
        apply(set, hostWorkerOnce, [ticket, row]);
        row.hostTicket = ticket;
        row.hostRequest = request;
        row.domainKnown = true;
        const spec = await reserve(row, {
            kind: 'host-worker', workerKind: request.workerKind, entry: request.entry, options: request.options, initialFrameBase64: request.initialFrameBase64
        });
        enter(row);
        const custody = stock(row);
        const handle = await custody.sdk<Worker>(() => {
            const previous = synchronousHostWorkerTicket;
            let value: Worker;
            synchronousHostWorkerTicket = ticket;
            try {
                value = apply(hostWorkerRun, hostWorkerScope, [ticket, () => new NativeWorker(spec.entry, spec.options)]) as Worker;
            }
            finally {
                synchronousHostWorkerTicket = previous;
            }
            row.raws.add(value);
            row.handle = value;
            if (isProxy(value) || prototype(value) !== workerPrototype)
                denied();
            attach(row);
            return value;
        }, undefined, [], { accept: value => value === row.handle, consumer: consumeMetadata });
        await custody.consumeResource(consumeMetadata, handle, []);
        inspectRefs(row, handle);
        return box({ handle, attempt: row.attempt });
    }
    catch (error) {
        return failedEntry(row, error);
    }
}
/** Passive identity only during the original constructor's synchronous SDK
 * segment. The ALS contains the empty original ticket, never Row/job/raws. */
export function readCurrentOriginalHostWorkerTicket(): object | null { const ticket = apply(hostWorkerGet, hostWorkerScope, []) as object | undefined; return ticket && ticket === synchronousHostWorkerTicket ? ticket : null; }
export function postOriginalHostWorkerRequest(attempt: unknown): Promise<void> {
    const row = rowOf(attempt);
    const request = row.hostRequest ?? row.sourceRequest;
    if (!request || !row.handle || row.hostMessageSent || row.physicalKnown || row.unknown)
        denied('TOOL_PROCESS_ORIGINAL_HOST_MESSAGE_REQUIRED');
    row.hostMessageSent = true;
    const custody = stock(row);
    return custody.root(async () => {
        custody.syncVoid(request.assertLocal, request, []);
        const encoded = request.initialFrameBase64;
        if (typeof encoded !== 'string')
            denied('TOOL_PROCESS_ORIGINAL_HOST_MESSAGE_REQUIRED');
        const bytes = apply(bufferFrom, Buffer, [encoded, 'base64']) as Buffer;
        row.raws.add(bytes);
        await metadata(row, bytes);
        const frame = apply(bufferToString, bytes, ['utf8']);
        row.raws.add(frame);
        custody.inventory(frame);
        current(row);
        row.bridge!.assertProcessLocal(row.permit!);
        custody.syncVoid(request.assertLocal, request, []);
        if (row.kind === 'worker') {
            custody.syncVoid(nativePost, row.handle, [frame]);
        } else if (row.sourceRequest?.operation === 'spawn') {
            const stream = row.streams.stdin;
            if (!stream || isProxy(stream)) denied('TOOL_PROCESS_ORIGINAL_HOST_MESSAGE_REQUIRED');
            // Writable.end returns the acquired stream, not void. Keep that
            // exact resource (or abnormal raw) boxed before Promise resolution.
            const shell = await custody.sdk<object>(() => {
                const returned = apply(nativeEnd, stream, [frame]);
                row.raws.add(returned);
                inspectRefs(row, returned);
                return box({returned});
            }, undefined, [], {accept: value => !!value && typeof value === 'object' && !isProxy(value), consumer: consumeMetadata});
            await custody.consumeResource(consumeMetadata, shell, []);
            await metadata(row, (shell as {returned: unknown}).returned);
        } else denied('TOOL_PROCESS_ORIGINAL_HOST_MESSAGE_REQUIRED');
    });
}
/** Private component fate is independent of the business first cause. A
 * missing/failed constructor result never supplies this fact by itself. */
export function readOriginalHostWorkerPhysicalFate(ticket: unknown): Readonly<{
    waitKnown(): Promise<void>;
    assertKnown(): void;
}> {
    const row = apply(get, hostWorkerOnce, [ticket]) as Row | undefined;
    if (!row)
        denied('TOOL_PROCESS_ORIGINAL_HOST_WORKER_REQUIRED');
    return sourcePhysicalFate(row);
}
export function readOriginalSourceProcessPhysicalFate(ticket:unknown):Readonly<{waitKnown():Promise<void>;assertKnown():void}> {
    const row=apply(get,sourceOnce,[ticket]) as Row|undefined;
    if(!row)denied('TOOL_PROCESS_ORIGINAL_SOURCE_REQUIRED');
    return sourcePhysicalFate(row);
}
function sourcePhysicalFate(row:Row):Readonly<{waitKnown():Promise<void>;assertKnown():void}> {
    const assertKnown = () => {
        if (!row.finished || row.unknown || !row.physicalKnown || !row.prefixStocks)
            denied();
        for (let i = 0; i < row.prefixStocks.length; i++)
            row.prefixStocks[i]!.assertPhysicalKnown();
    };
    return box({ assertKnown, async waitKnown() {
            try {
                await row.completion;
            }
            catch (error) {
                try {
                    assertKnown();
                    return;
                }
                catch {
                    throw error;
                }
            }
            assertKnown();
        } });
}
/** Inventory only: this cannot declare success or erase an unknown child. */
export function retainOriginalToolProcessValue(attempt: unknown, raw: unknown): void {
    const row = rowOf(attempt);
    row.raws.add(raw);
    if (row.physicalKnown || row.finished)
        denied('TOOL_PROCESS_ALREADY_ENDED');
    stock(row).inventory(raw);
}
/** A fixed completion-file owner keeps its actual descriptor/Stats resources.
 * Only its exact private raw/proof pair may replace generic value inventory. */
export function retainOriginalToolProcessFileOperation(attempt: unknown, raw: unknown, proof: unknown): void {
    const row = rowOf(attempt);
    row.raws.add(raw);
    row.raws.add(proof);
    if (row.physicalKnown || row.finished) denied('TOOL_PROCESS_ALREADY_ENDED');
    const custody = stock(row);
    const held = custody.root(async () => {
        let fate: ReturnType<typeof readOriginalCompletionFileOperation>;
        try { fate = readOriginalCompletionFileOperation(raw, proof); }
        catch (error) {
            // A wrong pair cannot erase an already accepted SDK raw or its tails.
            custody.inventory(raw);
            row.unknown = true;
            remember(row, error);
            throw error;
        }
        row.raws.add(fate);
        await custody.sdk(fate.waitKnown, fate, []);
        custody.syncVoid(fate.assertKnown, fate, []);
    });
    row.raws.add(held);
    apply(nativeThen, held, [() => check(row), (error: unknown) => {
        remember(row, error);
        row.unknown = true;
        check(row);
    }]);
}
export async function createOriginalToolWorker(entry: string | URL, options: WorkerOptions): Promise<Readonly<{
    handle: Worker;
    attempt: object;
}>> {
    const row = initial('worker');
    try {
        const uri = typeof entry === 'string' ? entry : apply(urlHref, entry, []) as string;
        if (hasOriginalMainSdkBridgeInstallation() && uri === ORIGINAL_BOUNDED_GLOB_WORKER_ENTRY)
            denied('TOOL_PROCESS_READONLY_LEAF_REQUIRED');
        const spec = await reserve(row, { kind: 'worker', entry: uri, options });
        const names = keys(spec.options);
        row.domainKnown = spec.entry === ORIGINAL_BOUNDED_GLOB_WORKER_ENTRY && names.length === 5 && names.every(name => ['workerData', 'resourceLimits', 'execArgv', 'stdout', 'stderr'].includes(name as string)) && isArray(spec.options.execArgv) && spec.options.execArgv.length === 0 && spec.options.stdout === true && spec.options.stderr === true;
        enter(row);
        const custody = stock(row);
        const handle = await custody.sdk<Worker>(() => {
            const value = new NativeWorker(spec.entry.startsWith('file:') || spec.entry.startsWith('data:') ? new URL(spec.entry) : spec.entry, spec.options);
            row.raws.add(value);
            row.handle = value;
            if (isProxy(value) || prototype(value) !== workerPrototype)
                denied();
            attach(row);
            return value;
        }, undefined, [], { accept: v => v === row.handle, consumer: consumeMetadata });
        await custody.consumeResource(consumeMetadata, handle, []);
        inspectRefs(row, handle);
        return box({ handle, attempt: row.attempt });
    }
    catch (error) {
        return failedEntry(row, error);
    }
}
/** The fixed original search producer changes transport, not algorithm or
 * authorization. Its Native P permit owns the kernel child and all pipe FDs;
 * no Worker/ChildProcess lookalike is returned to the caller. */
type ReadonlyLeafMethod = 'prepareReadonlyLeaf' | 'waitReadonlyLeafReady' | 'bindReadonlyLeaf' |
    'goReadonlyLeaf' | 'cancelReadonlyLeaf' | 'waitReadonlyLeafClosed';
async function readonlyLeafSdk<T>(row:Row,name:ReadonlyLeafMethod,args:unknown[]=[]):Promise<T> {
    const method=row.bridge![name];
    const positive=name==='prepareReadonlyLeaf'||name==='bindReadonlyLeaf'||name==='goReadonlyLeaf';
    let first:{raw:unknown}|undefined,result!:T;
    try{await metadata(row,method);}catch(raw){first={raw};}
    if(!first||!positive){
        const parameters:unknown[]=[row.permit];
        for(let i=0;i<args.length;i++)appendIntrinsic(parameters,args[i]);
        try{result=await stock(row).sdk<T>(method,row.bridge,parameters);}
        catch(raw){if(!first)first={raw};}
    }
    try{await metadata(row,method);}catch(raw){if(!first)first={raw};}
    if(first)throw first.raw;
    return result;
}
export async function runOriginalBoundedReadonlyLeaf(options: WorkerOptions, signal?: AbortSignal): Promise<unknown> {
    const row = initial('readonly_leaf');
    let first: {raw: unknown} | undefined;
    let response: unknown;
    let closure: Promise<{stdout:string;stderr:string;exitCode:number;signal:number;timedOut:boolean}> | undefined;
    let abort: (() => void) | undefined;
    const checkAbort = () => {
        if (signal === undefined) return;
        if (isProxy(signal)) denied('TOOL_PROCESS_ABORT_SIGNAL_REQUIRED');
        // The captured Native method supplies the brand check and preserves an
        // explicitly undefined abort reason. No public getter/method is read.
        stock(row).syncVoid(abortSignalThrow, signal, []);
    };
    try {
        const spec = await reserve(row, {kind:'worker', entry:ORIGINAL_BOUNDED_GLOB_WORKER_ENTRY, options});
        if (!row.bridge || !row.permit) denied('TOOL_PROCESS_ORIGINAL_MAIN_BRIDGE_REQUIRED');
        checkAbort();
        if (signal !== undefined) await metadata(row, signal);
        enter(row);
        await readonlyLeafSdk(row,'prepareReadonlyLeaf',[canonical(spec)]);
        const cancel = () => {
            // The callback's complete async operation is held before its first
            // metadata/SDK step, including gaps between its accepted children.
            const callbackStock=stock(row);
            const raw = callbackStock.root(()=>readonlyLeafSdk<void>(row,'cancelReadonlyLeaf'));
            row.raws.add(raw);
            apply(nativeThen, raw, [() => {}, (error:unknown) => {stock(row).inventory(error);remember(row,error);row.unknown=true;}]);
        };
        abort = cancel;
        inspectRefs(row, abort);
        if (signal !== undefined) {
            stock(row).syncVoid(addEvent, signal, ['abort', abort, {once:true}]);
            await metadata(row, signal);
            await metadata(row, abort);
            if (apply(abortSignalAborted, signal, [])) cancel();
        }
        const ready = await readonlyLeafSdk<object>(row,'waitReadonlyLeafReady');
        current(row); checkAbort();
        await readonlyLeafSdk(row,'bindReadonlyLeaf',[ready]);
        current(row); checkAbort();
        closure = readonlyLeafSdk(row,'waitReadonlyLeafClosed');
        row.raws.add(closure);
        row.bridge.assertProcessLocal(row.permit);
        stock(row).syncVoid(assertOriginalToolProcessAuthorizationLocal, undefined, [row.authorization]);
        await readonlyLeafSdk(row,'goReadonlyLeaf');
        const closed = await closure;
        if (closed.timedOut) throw new NativeError('glob_timeout');
        if (closed.exitCode !== 0 || closed.signal !== 0) throw new NativeError('glob_worker_failed');
        response = parseJson(closed.stdout);
    } catch (raw) {
        first = {raw}; remember(row,raw); stock(row).inventory(raw);
    } finally {
        if (abort && signal !== undefined) {
            try {
                stock(row).syncVoid(removeEvent, signal, ['abort', abort]);
                await metadata(row, signal);
                await metadata(row, abort);
            } catch (raw) {
                remember(row,raw); stock(row).inventory(raw);
                if (!first) first = {raw};
            }
        }
        if (row.constructEntered && row.bridge && row.permit) {
            // A failed/unknown closed wrapper is not a cleanup action. Always
            // enter the original negative cancellation on failure, including
            // when a private closed observation was already requested.
            if (first || !closure) {
                try { await readonlyLeafSdk(row,'cancelReadonlyLeaf'); }
                catch (raw) {
                    stock(row).inventory(raw);remember(row,raw);
                    if (!first) first={raw};
                }
            }
            try {
                if (!closure) {
                    // Join an actual READY SDK operation even if its wrapper
                    // failed before returning the original Promise to Core.
                    try { await readonlyLeafSdk(row,'waitReadonlyLeafReady'); }
                    catch (raw) { stock(row).inventory(raw); }
                    closure = readonlyLeafSdk(row,'waitReadonlyLeafClosed');
                    row.raws.add(closure);
                }
                await closure;
                row.domainKnown = true;
            } catch (raw) {
                stock(row).inventory(raw); remember(row,raw); row.unknown = true;
                if (!first) first = {raw};
            }
            row.terminal = true; row.listenersOpen = false;
            check(row);
            try { await row.completion; } catch (raw) { if (!first) first = {raw}; }
        }
    }
    if (first) {
        if (!row.constructEntered) return failedEntry(row,first.raw);
        throw first.raw;
    }
    return response;
}
export async function spawnSyncOriginalToolProcess(command: string, argv: readonly string[], options: SpawnSyncOptions): Promise<Readonly<{
    result: ReturnType<typeof spawnSync>;
    attempt: object;
}>> {
    const row = initial('sync');
    try {
        const spec = await reserve(row, {
            kind: 'spawnSync', command, argv, options
        });
        enter(row);
        const custody = stock(row);
        const result = await custody.sdk<ReturnType<typeof spawnSync>>(() => nativeSpawnSync(spec.command, spec.argv as string[], spec.options), undefined, [], { accept: v => v !== null && typeof v === 'object' && !isProxy(v), consumer: consumeMetadata });
        await custody.consumeResource(consumeMetadata, result, []);
        inspectRefs(row, result);
        // An error without a returned ChildProcess cannot infer never-born. Keep
        // its actual raw and P until a separately certified SDK contract exists.
        if (result.error) {
            row.unknown = true;
            throw result.error;
        }
        row.terminal = true;
        row.listenersOpen = false;
        check(row);
        return box({ result, attempt: row.attempt });
    }
    catch (error) {
        return failedEntry(row, error);
    }
}
export function listenOriginalToolProcess(attempt: unknown, endpoint: Endpoint, eventName: string, callback: Function): void {
    const row = rowOf(attempt);
    if (!row.listenersOpen || typeof callback !== 'function' || isProxy(callback))
        denied('TOOL_PROCESS_LISTENER_CLOSED');
    if (endpoint !== 'child' && endpoint !== 'stdout' && endpoint !== 'stderr' && endpoint !== 'stdin')
        denied();
    appendIntrinsic(row.handlers, { endpoint, event: eventName, fn: callback });
    row.raws.add(callback);
    if (endpoint !== 'child' && eventName === 'data') {
        const stream = row.streams[endpoint];
        if (!stream)
            denied();
        if (!row.handlers.slice(0, -1).some(value => value.endpoint === endpoint && value.event === 'data'))
            registerListener(row, stream, readableOn, 'data', (...args: unknown[]) => event(row, endpoint, 'data', args));
    }
}
export function sealOriginalToolProcessListeners(attempt: unknown): void {
    const row = rowOf(attempt);
    if (!row.listenersOpen)
        return;
    row.listenersOpen = false;
    const frames = row.frames;
    row.frames = [];
    row.dispatching++;
    try {
        for (let i = 0; i < frames.length; i++)
            dispatch(row, frames[i]!);
    }
    finally {
        row.dispatching--;
        check(row);
    }
}
export function waitOriginalToolProcessPhysical(attempt: unknown): Promise<object> { return rowOf(attempt).completion; }
/** An original SDK child association only. This is neither a live effect
 * permission nor a descendant/quiescence certificate, even after parent exit. */
export function readOriginalToolProcessKernelObservation(attempt: unknown): Readonly<{
    context: object | null; invocationId: string; specHash: string; pid: number;
    nativeMetered: boolean; assertLocal(): void;
}> {
    const row = rowOf(attempt);
    if (row.kind !== 'process' || !row.constructEntered || !row.handle || row.originalPid === undefined)
        denied('TOOL_PROCESS_ORIGINAL_CHILD_REQUIRED');
    const handle = row.handle, pid = row.originalPid;
    const assertLocal = () => {
        if (row.kernelObservationFailed || row.handle !== handle || row.originalPid !== pid || !row.constructEntered)
            denied('TOOL_PROCESS_ORIGINAL_CHILD_REQUIRED');
        const current = descriptor(handle, 'pid');
        if (!current || !own(current, 'value') || current.value !== pid) {
            row.kernelObservationFailed = true;
            row.unknown = true;
            row.raws.add(current);
            denied('TOOL_PROCESS_ORIGINAL_CHILD_UNCONFIRMED');
        }
    };
    assertLocal();
    return box({context: row.context, invocationId: row.id, specHash: row.hash,
        pid, nativeMetered: row.bridge !== null, assertLocal});
}
export function readOriginalToolProcessPhysicalReceipt(context: unknown, permit: unknown, receipt: unknown): Readonly<{
    invocationId: string;
    specHash: string;
    nativeMetered: boolean;
    assertKnown(): void;
}> {
    const row = apply(get, receipts, [receipt]) as Row | undefined;
    if (!row || row.context !== context || row.permit !== permit)
        denied('TOOL_PROCESS_ORIGINAL_RECEIPT_REQUIRED');
    const assertKnown = () => {
        if (row.bridge && row.constructEntered && !row.domainKnown)
            denied('TOOL_PROCESS_WHOLE_DOMAIN_UNCONFIRMED');
        if (row.unknown || !row.physicalKnown || !row.prefixStocks || !row.terminal || row.listenersOpen || row.dispatching)
            denied();
        for (let i = 0; i < row.prefixStocks.length; i++)
            row.prefixStocks[i]!.assertPhysicalKnown();
    };
    return box({
        invocationId: row.id, specHash: row.hash, nativeMetered: row.bridge !== null, componentOnly: !row.domainKnown, assertKnown
    });
}
/** Only absence permits the fixed Owner to try another original receipt family.
 * A genuine member with the wrong context or permit remains a strict failure. */
export function readOptionalOriginalToolProcessPhysicalReceipt(context: unknown, permit: unknown, receipt: unknown): ReturnType<typeof readOriginalToolProcessPhysicalReceipt> | undefined {
    if (!apply(get, receipts, [receipt]))
        return undefined;
    return readOriginalToolProcessPhysicalReceipt(context, permit, receipt);
}
/** Negative SDK controls on the exact acquired resource; no new process is
 * spawned here and no current effect permission is revived. */
export function terminateOriginalToolProcess(attempt: unknown, signal: NodeJS.Signals = 'SIGKILL'): Promise<void> {
    const row = rowOf(attempt);
    if (row.physicalKnown)
        denied('TOOL_PROCESS_ALREADY_ENDED');
    const custody = stock(row);
    return custody.root(async () => {
        if (!row.handle)
            denied();
        if (row.kind === 'worker')
            await custody.sdk(nativeTerminate, row.handle, []);
        else
            await custody.sdk(nativeKill, row.handle, [signal]);
    });
}
