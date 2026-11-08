import { retainOriginalHarnessOwnerLocksForSource, retryRequestedHarnessOwnerReleases } from './harness-optimization-owner-lock.js';
import { types } from 'node:util';
import { Worker } from 'node:worker_threads';
import { resolve } from 'node:path';
import { assertOrdinarySourceWriterRoute, observeOrdinarySQLiteWriter } from '../../src/runtime/verification/ordinary-source-writer-observation.js';
import { createRoomTurnCustody } from '../../src/runtime/verification/original-sdk-custody.js';
import { appendIntrinsic, createIntrinsicSet, settleIntrinsicOperations } from '../../src/runtime/verification/intrinsic-async-collection.js';
const isProxy = types.isProxy, NativeWorker = Worker, terminate = Worker.prototype.terminate, post = Worker.prototype.postMessage;
const apply = Reflect.apply, then = Promise.prototype.then, NativePromise = Promise, NativeError = Error;
const freeze = Object.freeze, descriptor = Object.getOwnPropertyDescriptor, own = Object.hasOwn, keys = Reflect.ownKeys, create = Object.create, define = Object.defineProperty;
const NativeShared = SharedArrayBuffer, NativeInt32 = Int32Array, storeAtomic = Atomics.store;
const privateLatch = 'originalOrdinaryBudgetRetirement';
interface Row {
    path: string;
    birth: object;
    stock: ReturnType<typeof createRoomTurnCustody>;
    negative: ReturnType<typeof createRoomTurnCustody>;
    worker?: Worker;
    acquisition?: Promise<Worker>;
    closing?: Promise<void>;
    constructorEntered: boolean;
    exited: boolean;
    terminated: boolean;
    unknown: boolean;
    raws: unknown[];
    notifications: ReturnType<typeof createRoomTurnCustody>[];
    notified: boolean;
    onFailure?: () => void;
    failure?: {
        raw: unknown;
    };
    retired?: Error;
    latch: Int32Array;
    ownerCurrent?: () => void;
}
const members = new WeakMap<object, Row>(), get = WeakMap.prototype.get, set = WeakMap.prototype.set;
const mapGet = Map.prototype.get, mapSet = Map.prototype.set, mapDelete = Map.prototype.delete;
// The original owner inventory contains every admitted live/unknown birth.
// A ready Worker is still a physical resource; ready never removes its row.
const held = createIntrinsicSet<Row>(), failedPaths = new Map<string, Row>();
const gateStock = createRoomTurnCustody();
let globalRetired: Error | undefined, population: readonly Row[] | undefined, populationTask: Promise<void> | undefined;
export interface OriginalBudgetSourceWorker {
    readonly worker: Worker;
    readonly birth: object;
    readonly acquisition: Promise<Worker>;
}
function row(birth: object): Row {
    const value = apply(get, members, [birth]) as Row | undefined;
    if (!value)
        throw new NativeError('budget_source_birth');
    return value;
}
function key(path: string) { return path === '' || path === ':memory:' ? path : resolve(path); }
function remember(value: Row, raw: unknown) {
    value.failure ??= { raw };
    appendIntrinsic(value.raws, raw);
    try {
        value.stock.inventory(raw);
    }
    catch (secondary) {
        appendIntrinsic(value.raws, secondary);
        value.unknown = true;
    }
    held.add(value);
    apply(mapSet, failedPaths, [value.path, value]);
}
function assertKnown(value: Row) {
    if (value.unknown || value.constructorEntered && (!value.terminated || !value.exited))
        throw new NativeError('budget_source_physical_unconfirmed');
    value.stock.assertPhysicalKnown();
    value.negative.assertPhysicalKnown();
    for (let i = 0; i < value.notifications.length; i++)
        value.notifications[i]!.assertPhysicalKnown();
}
function release(value: Row) {
    assertKnown(value);
    held.delete(value);
    if (!value.retired && apply(mapGet, failedPaths, [value.path]) === value)
        apply(mapDelete, failedPaths, [value.path]);
}
function isolate(value: Row, raw: unknown, shared?: Error) {
    value.retired ??= shared ?? new NativeError('budget_source_writer_retired', { cause: raw });
    apply(storeAtomic, Atomics, [value.latch, 0, 1]);
    remember(value, raw);
}
function notice(value: Row) {
    if (value.onFailure)
        notifyOriginalBudgetSourceFailure(value.birth, value.onFailure);
}
function closeRows(rows: readonly Row[]): Promise<void> {
    return new NativePromise<void>((yes, no) => {
        const operation = (async () => {
            const outcomes = await settleIntrinsicOperations(rows, value => closeOriginalBudgetSourceWorker(value.birth));
            // Keep the policy SDK's own known tails even when another row is unknown.
            let failure: {
                raw: unknown;
            } | undefined;
            for (let i = 0; i < outcomes.length; i++) {
                const outcome = outcomes[i]!;
                if (outcome.status === 'rejected')
                    failure ??= { raw: outcome.reason };
            }
            try {
                await gateStock.waitPhysicalKnown();
            }
            catch (raw) {
                failure ??= { raw };
            }
            if (failure)
                throw failure.raw;
            for (let i = 0; i < rows.length; i++)
                assertKnown(rows[i]!);
        })();
        void apply(then, operation, [yes, no]);
    });
}
function retirePopulation(raw: unknown): Error {
    if (globalRetired)
        return globalRetired;
    globalRetired = new NativeError('budget_source_writer_retired', { cause: raw });
    population = freeze(held.snapshot());
    // Admission and every latch are cut before a callback, negative SDK or await.
    for (let i = 0; i < population.length; i++)
        isolate(population[i]!, raw, globalRetired);
    for (let i = 0; i < population.length; i++)
        notice(population[i]!);
    populationTask = closeRows(population);
    void apply(then, populationTask, [() => { }, () => { }]);
    return globalRetired;
}
/** Original ordinary birth gate, never protected preparation or a grant. */
export function assertOriginalBudgetSourceBirthAllowed(): void {
    if (globalRetired)
        throw globalRetired;
    try {
        gateStock.syncVoid(assertOrdinarySourceWriterRoute, undefined, []);
    }
    catch (raw) {
        throw retirePopulation(raw);
    }
    if (globalRetired)
        throw globalRetired;
}
/** Read-only facts for this process's original factory population, not a
 * whole-file, all-process, canonical Source or resource permission receipt. */
export function readOriginalBudgetSourcePopulationFate() {
    if (!population || !populationTask)
        throw new NativeError('budget_source_not_retired');
    const actual = population, operation = populationTask;
    return freeze({ scope: 'current-process-original-budget-workers' as const,
        wait: () => operation,
        assertPhysicallyKnown() { gateStock.assertPhysicalKnown(); for (let i = 0; i < actual.length; i++)
            assertKnown(actual[i]!); },
    });
}
function dataWithLatch(data: Record<string, unknown>, latch: SharedArrayBuffer) {
    const copy = create(null), names = keys(data);
    for (let i = 0; i < names.length; i++) {
        const name = names[i]!;
        if (typeof name !== 'string')
            throw new NativeError('budget_source_data');
        const field = descriptor(data, name);
        if (!field || !own(field, 'value'))
            throw new NativeError('budget_source_data');
        define(copy, name, { __proto__: null, value: field.value, enumerable: field.enumerable } as PropertyDescriptor);
    }
    define(copy, privateLatch, { __proto__: null, value: latch, enumerable: true } as PropertyDescriptor);
    return copy;
}
/** Ordinary discovery only. This private revocation carrier grants no role,
 * protected birth, namespace completeness or capacity. It is never returned. */
export function openOriginalBudgetSourceWorker(data: Record<string, unknown>, onFailure?: () => void): OriginalBudgetSourceWorker {
    if (globalRetired)
        throw globalRetired;
    if (!data || typeof data !== 'object' || isProxy(data))
        throw new NativeError('budget_source_path');
    if (own(data, privateLatch))
        throw new NativeError('budget_source_private_latch');
    const field = descriptor(data, 'dbPath');
    if (!field || !own(field, 'value') || typeof field.value !== 'string')
        throw new NativeError('budget_source_path');
    const path = key(field.value), prior = apply(mapGet, failedPaths, [path]) as Row | undefined;
    if (prior)
        throw prior.retired ?? new NativeError('budget_source_initialization_unknown', { cause: prior.failure?.raw });
    const birth = freeze({}), buffer = new NativeShared(4);
    const value: Row = { path, birth, stock: createRoomTurnCustody(), negative: createRoomTurnCustody(), constructorEntered: false,
        exited: false, terminated: false, unknown: false, raws: [], notifications: [], notified: false, onFailure, latch: new NativeInt32(buffer) };
    apply(set, members, [birth, value]);
    held.add(value);
    try {
        value.stock.syncVoid(() => {
            const current = retainOriginalHarnessOwnerLocksForSource(value.path, () => assertKnown(value), raw => remember(value, raw));
            if (current)
                value.ownerCurrent = current;
        }, undefined, []);
    }
    catch (raw) {
        value.unknown = true;
        remember(value, raw);
        throw raw;
    }
    try {
        value.stock.syncVoid(assertOrdinarySourceWriterRoute, undefined, []);
    }
    catch (raw) {
        remember(value, raw);
        throw retirePopulation(raw);
    }
    if (globalRetired)
        throw globalRetired;
    value.ownerCurrent?.();
    let constructorFailure: {
        raw: unknown;
    } | undefined;
    const acquisition = value.stock.sdk<Worker>(() => {
        try {
            const workerData = dataWithLatch(data, buffer);
            value.ownerCurrent?.();
            value.constructorEntered = true;
            value.worker = new NativeWorker(new URL('./harness-optimization-store-worker.mjs', import.meta.url), { workerData, execArgv: ['--no-warnings'] });
            return value.worker;
        }
        catch (raw) {
            constructorFailure = { raw };
            value.unknown = true;
            remember(value, raw);
            throw raw;
        }
    }, undefined, [], { accept: actual => actual === value.worker, consumer: terminate });
    value.acquisition = acquisition;
    void apply(then, acquisition, [() => { }, (raw: unknown) => remember(value, raw)]);
    if (!value.worker) {
        value.unknown = true;
        throw constructorFailure ? constructorFailure.raw : new NativeError('budget_source_constructor_unknown');
    }
    value.worker.once('exit', () => { value.exited = true; });
    return freeze({ worker: value.worker, birth, acquisition });
}
export function assertOriginalBudgetSourceCommandCurrent(birth: object): void {
    const value = row(birth);
    if (value.retired)
        throw value.retired;
    if (globalRetired)
        throw globalRetired;
    if (value.closing || value.failure || value.unknown)
        throw value.failure ? value.failure.raw : new NativeError('budget_source_unavailable');
    try {
        value.stock.syncVoid(assertOrdinarySourceWriterRoute, undefined, []);
    }
    catch (raw) {
        throw retirePopulation(raw);
    }
    assertOriginalBudgetSourceLocal(birth);
}
/** Pure-local last gate, after all caller/current callbacks and before post. */
export function assertOriginalBudgetSourceLocal(birth: object): void {
    const value = row(birth);
    if (value.retired)
        throw value.retired;
    if (globalRetired)
        throw globalRetired;
    if (value.closing || value.failure || value.unknown)
        throw value.failure ? value.failure.raw : new NativeError('optimization_store_unavailable');
    value.ownerCurrent?.();
}
export function readOriginalBudgetSourceRetirement(birth: object): Error | undefined { return row(birth).retired; }
export function postOriginalBudgetSourceWorker(birth: object, message: object, negative = false): void {
    const value = row(birth), stock = negative ? value.negative : value.stock;
    if (!negative)
        assertOriginalBudgetSourceLocal(birth);
    try {
        stock.syncVoid(post, value.worker, [message]);
    }
    catch (raw) {
        remember(value, raw);
        if (!negative) {
            isolate(value, raw);
            notice(value);
            void apply(then, closeOriginalBudgetSourceWorker(birth), [() => { }, () => { }]);
        }
        throw raw;
    }
}
export function completeOriginalBudgetSourceWorker(birth: object): void {
    const value = row(birth);
    if (value.closing || value.failure || value.unknown)
        throw value.failure ? value.failure.raw : new NativeError('budget_source_unavailable');
    try {
        assertOriginalBudgetSourceCommandCurrent(birth);
        value.stock.syncVoid(observeOrdinarySQLiteWriter, undefined, [value.path, 'harness-budget-sqlite-v1']);
        assertOriginalBudgetSourceCommandCurrent(birth);
    }
    catch (raw) {
        remember(value, raw);
        throw raw;
    }
}
export function notifyOriginalBudgetSourceFailure(birth: object, callback: () => void): void {
    const value = row(birth);
    if (value.notified)
        return;
    value.notified = true;
    const stock = createRoomTurnCustody();
    appendIntrinsic(value.notifications, stock);
    try {
        stock.syncVoid(callback, undefined, []);
    }
    catch (raw) {
        remember(value, raw);
    }
}
export function retainOriginalBudgetSourceFailure(birth: object, raw: unknown): void { remember(row(birth), raw); }
/** Captured negative consumer. Failed Source checks never block the actual
 * terminate SDK, exit observation or the other inventories' known joins. */
export function closeOriginalBudgetSourceWorker(birth: object): Promise<void> {
    const value = row(birth);
    if (value.closing)
        return value.closing;
    let yes!: () => void, no!: (raw: unknown) => void;
    value.closing = new NativePromise<void>((resolve, reject) => { yes = resolve; no = reject; });
    const operation = (async () => {
        let failure: {
            raw: unknown;
        } | undefined;
        if (value.worker) {
            try {
                await value.stock.consumeResource(terminate, value.worker, []);
            }
            catch (raw) {
                failure = { raw };
                remember(value, raw);
            }
        }
        else if (value.constructorEntered || value.unknown) {
            failure = value.failure ?? { raw: new NativeError('budget_source_constructor_unknown') };
        }
        const stocks = [value.stock, value.negative];
        for (let i = 0; i < value.notifications.length; i++)
            appendIntrinsic(stocks, value.notifications[i]!);
        const joined = await settleIntrinsicOperations(stocks, stock => stock.waitPhysicalKnown());
        for (let i = 0; i < joined.length; i++) {
            const outcome = joined[i]!;
            if (outcome.status === 'rejected') {
                failure ??= { raw: outcome.reason };
                remember(value, outcome.reason);
            }
        }
        if (!failure)
            try {
                if (value.constructorEntered) {
                    if (!value.exited)
                        throw new NativeError('budget_source_exit_unconfirmed');
                    value.terminated = true;
                }
                release(value);
                retryRequestedHarnessOwnerReleases();
            }
            catch (raw) {
                failure = { raw };
                remember(value, raw);
            }
        if (failure)
            throw value.failure ? value.failure.raw : failure.raw;
    })();
    void apply(then, operation, [yes, no]);
    return value.closing;
}
export function readOriginalBudgetSourceWorkerFate(birth: object): Readonly<{
    path: string;
    assertTerminated(): void;
}> {
    const value = row(birth);
    return freeze({ path: value.path, assertTerminated() {
            if (!value.constructorEntered)
                throw new NativeError('budget_source_worker_not_entered');
            assertKnown(value);
        } });
}
