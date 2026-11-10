import { types } from 'node:util';
import { retainSourceErrorTails } from './source-error-tails.js';
import { createIntrinsicSet, appendIntrinsic } from './intrinsic-async-collection.js';
import { assertStandardIpcPromise } from './native-ipc-promise.js';
const NativeWeakMap = WeakMap, NativeWeakSet = WeakSet;
const NativePromise = Promise, nativeThen = Promise.prototype.then, apply = Reflect.apply, define = Object.defineProperty, create = Object.create, freeze = Object.freeze;
const prototype=Object.getPrototypeOf;
const descriptor = Object.getOwnPropertyDescriptor, keys = Reflect.ownKeys, own = Object.hasOwn, isProxy = types.isProxy, isPromise = types.isPromise, isMap = types.isMap, isSet = types.isSet, isError = types.isNativeError;
const add = WeakSet.prototype.add, has = WeakSet.prototype.has, remove = WeakSet.prototype.delete, weakGet = WeakMap.prototype.get, weakSet = WeakMap.prototype.set;
const mapEntries = Map.prototype.entries, mapNext = Object.getPrototypeOf(new Map().entries()).next, setValues = Set.prototype.values, setNext = Object.getPrototypeOf(new Set().values()).next;
const stack = descriptor(new Error(), 'stack'), members = new NativeWeakSet<object>();
const unconfirmed = () => Error('ROOM_TURN_SOURCE_SDK_UNCONFIRMED');
interface ResourceContract {
    accept(value: unknown): boolean;
    consumer: Function;
    strictProxyGraph?:boolean;
    /** Fixed original producer resource classification, not an effect grant. */
    failureResource?:ResourceContract;
}
export interface RoomTurnCustody {
    current(): void;
    local(): void;
    accepted(): void;
    seal(): void;
    drain(): Promise<void>;
    waitKnown():Promise<void>;
    waitPhysicalKnown():Promise<void>;
    assertPhysicalKnown():void;
    root<T>(work: () => Promise<T>): Promise<T>;
    sdk<T>(fn: Function, receiver: unknown, args: unknown[], resource?: ResourceContract): Promise<T>;
    consumeResource<T>(fn: Function, resource: object, args: unknown[]): Promise<T>;
    inventory(value: unknown): void;
    syncVoid(fn:Function,receiver:unknown,args:unknown[]):void;
}
export function assertRoomTurnCustody(value: unknown): asserts value is RoomTurnCustody {
    if (!value || typeof value !== 'object' || !apply(has, members, [value]))
        throw unconfirmed();
}
/** Original composition bookkeeping only. Resource scanning inventories visible
 * slots; fixed body settlement does not certify hidden Native algorithms. */
export function createRoomTurnCustody(): RoomTurnCustody {
    const retained = createIntrinsicSet<unknown>(), observed = new NativeWeakSet<object>(), scanning = new NativeWeakSet<object>(), unknown = createIntrinsicSet<unknown>();
    const resources = new NativeWeakMap<object, ResourceContract>(), heldResources = createIntrinsicSet<object>();
    const roots = createIntrinsicSet<object>(), tails = createIntrinsicSet<object>(), waiters = createIntrinsicSet<() => void>();
    let sealed = false, failed = false, failure: unknown, closing: Promise<void> | undefined;
    const internal = <T>(raw: Promise<T>): Promise<T> => {
        define(raw, 'constructor', { __proto__: null, value: NativePromise } as PropertyDescriptor);
        return raw;
    };
    const notify = () => {
        const rows = waiters.snapshot();
        for (let i = 0; i < rows.length; i++)
            rows[i]!();
    };
    const fail = (error: unknown) => {
        if (!failed) {
            failed = true;
            failure = error;
        }
    };
    const opaque = (raw: unknown) => {
        retained.add(raw);
        unknown.add(raw);
        fail(unconfirmed());
    };
    function local() {
        if (failed)
            throw failure;
        if (sealed)
            throw Error('ROOM_TURN_SOURCE_CLOSED');
    }
    function inventory(value: unknown) {
        retainSourceErrorTails(value, (raw, kind) => {
            if (kind === 'unknown')
                opaque(raw);
            if (isPromise(raw) && !isProxy(raw))
                retain(raw);
        });
    }
    function promiseChildren(raw: object) {
        if (apply(has, scanning, [raw]))
            return;
        apply(add, scanning, [raw]);
        try {
            const names = keys(raw);
            for (let i = 0; i < names.length; i++) {
                const key = names[i]!, row = descriptor(raw, key);
                if (key === 'constructor' && row && own(row, 'value') && row.value === NativePromise)
                    continue;
                if (!row || !own(row, 'value'))
                    opaque(raw);
                else
                    inventory(row.value);
            }
        }
        finally {
            apply(remove, scanning, [raw]);
        }
    }
    // A Response is an owned resource, not a plain DTO. Traverse its visible own
    // graph (also Native container slots) without invoking accessors. Do not skip
    // an entire Symbol(state), function, stream or HeadersList node by its name.
    function resourceInventory(root: unknown,strictProxyGraph=false) {
        const seen = createIntrinsicSet<unknown>(), work: Array<{
            value: unknown;
            depth: number;
        }> = [];
        let nodes = 0;
        const push = (value: unknown, depth: number) => {
            if (value !== null && (typeof value === 'object' || typeof value === 'function')) {
                if (work.length >= 65536 || depth > 128) {
                    opaque(value);
                    return;
                }
                appendIntrinsic(work, { value, depth });
            }
        };
        const reflect = (fn: Function, args: unknown[], node: unknown): {
            ok: true;
            value: unknown;
        } | {
            ok: false;
        } => {
            const reservation = create(null);
            roots.add(reservation);
            try {
                const raw = apply(fn, undefined, args);
                define(reservation, 'raw', { __proto__: null, value: raw } as PropertyDescriptor);
                return { ok: true, value: raw };
            }
            catch (error) {
                define(reservation, 'failure', { __proto__: null, value: error } as PropertyDescriptor);
                fail(error);
                inventory(error);
                opaque(node);
                return { ok: false };
            }
            finally {
                roots.delete(reservation);
                notify();
            }
        };
        push(root, 0);
        for (let index = 0; index < work.length; index++) {
            const { value, depth } = work[index]!;
            if (seen.has(value))
                continue;
            seen.add(value);
            if (++nodes > 65536) {
                opaque(value);
                continue;
            }
            if(strictProxyGraph&&isProxy(value)){opaque(value);continue;}
            // Only this already fixed-consumer-validated resource graph can contain
            // Node's Native Proxy state. Its reflection is SDK work, not a DTO read.
            if (!isProxy(value) && isPromise(value)) {
                retain(value);
                promiseChildren(value);
                continue;
            }
            if (!isProxy(value) && (isMap(value) || isSet(value))) {
                const map = isMap(value), iterator = apply(map ? mapEntries : setValues, value, []);
                for (;;) {
                    const row = apply(map ? mapNext : setNext, iterator, []) as IteratorResult<unknown>;
                    if (row.done)
                        break;
                    if (map) {
                        const pair = row.value as [
                            unknown,
                            unknown
                        ];
                        push(pair[0], depth + 1);
                        push(pair[1], depth + 1);
                    }
                    else
                        push(row.value, depth + 1);
                }
            }
            const listed = reflect(keys, [value], value);
            if (!listed.ok)
                continue;
            const names = listed.value as PropertyKey[];
            for (let i = 0; i < names.length; i++) {
                const name = names[i]!, found = reflect(descriptor, [value, name], value);
                if (!found.ok)
                    continue;
                const row = found.value as PropertyDescriptor | undefined;
                if (!row || !own(row, 'value')) {
                    if (!isProxy(value) && isError(value) && name === 'stack' && row && stack && typeof stack.get === 'function' && row.get === stack.get && row.set === stack.set)
                        continue;
                    opaque(value);
                    continue;
                }
                push(row.value, depth + 1);
            }
        }
    }
    function retain(raw: unknown, resource?: ResourceContract) {
        retained.add(raw);
        if (!raw || !isPromise(raw) || isProxy(raw)) {
            opaque(raw);
            return;
        }
        if (apply(has, observed, [raw])) {
            promiseChildren(raw);
            return;
        }
        apply(add, observed, [raw]);
        const row = create(null);
        define(row, 'raw', { __proto__: null, value: raw } as PropertyDescriptor);
        tails.add(row);
        try {
            promiseChildren(raw);
            if (descriptor(raw, 'then'))
                throw unconfirmed();
            assertStandardIpcPromise(raw, 'ROOM_TURN_SOURCE_SDK_UNCONFIRMED');
            apply(nativeThen, raw, [(value: unknown) => settle(value, false), (error: unknown) => settle(error, true)]);
        }
        catch (error) {
            fail(error);
            inventory(error);
            opaque(raw);
            tails.delete(row);
            notify();
        }
        function settle(value: unknown, rejected: boolean) {
            define(row, 'value', { __proto__: null, value, writable: true, configurable: true } as PropertyDescriptor);
            if (resource)
                retained.add(value);
            try {
                if (rejected)
                    fail(value);
                promiseChildren(raw as object);
                const selected=rejected?resource?.failureResource:resource;
                if(selected&&selected.accept(value))resourceInventory(value,selected.strictProxyGraph===true);
                else inventory(value);
            }
            catch (error) {
                fail(error);
                inventory(error);
                opaque(value);
            }
            finally {
                if (!unknown.has(raw))
                    retained.delete(raw);
                tails.delete(row);
                notify();
            }
        }
    }
    function assertResourceDelivery(value:unknown):void {
        // Promise resolution itself reads `then`. A rejected/unknown resource
        // must never be handed to that implicit caller-controlled operation.
        if(failed)throw failure;
        let current=value;
        for(let depth=0;current!==null;depth++){
            if(depth>128||!current||typeof current!=='object'&&typeof current!=='function'||isProxy(current)){
                opaque(value);throw unconfirmed();
            }
            if(descriptor(current,'then')){opaque(value);throw unconfirmed();}
            current=prototype(current);
        }
    }
    function sdk<T>(fn: Function, receiver: unknown, args: unknown[], resource?: ResourceContract, cleanup = false): Promise<T> {
        if (!cleanup)
            local();
        const reservation = create(null);
        roots.add(reservation);
        return internal(new NativePromise<T>((yes, no) => {
            let raw: unknown;
            const finishResource = () => {
                if (cleanup && receiver && typeof receiver === 'object') {
                    resourceInventory(receiver,(apply(weakGet,resources,[receiver]) as ResourceContract|undefined)?.strictProxyGraph===true);
                    const contract = apply(weakGet, resources, [receiver]) as ResourceContract;
                    if (contract.consumer === fn) {
                        heldResources.delete(receiver);
                        if (!unknown.has(receiver))
                            retained.delete(receiver);
                    }
                }
            };
            const end = (value: unknown, rejected: boolean) => {
                try {
                    if (rejected) {
                        fail(value);
                        const contract=resource?.failureResource;
                        if(contract&&contract.accept(value)){
                            retained.add(value);heldResources.add(value as object);
                            apply(weakSet,resources,[value,contract]);
                            resourceInventory(value,contract.strictProxyGraph===true);
                        }else inventory(value);
                        no(value);
                        return;
                    }
                    if (resource) {
                        retained.add(value);
                        if (!resource.accept(value)) {
                            inventory(value);
                            opaque(value);
                            throw unconfirmed();
                        }
                        heldResources.add(value as object);
                        apply(weakSet, resources, [value, resource]);
                        resourceInventory(value,resource.strictProxyGraph===true);
                    }
                    else
                        inventory(value);
                    if (!cleanup && !resource) {
                        try {
                            local();
                        }
                        catch (error) {
                            no(error);
                            return;
                        }
                    }
                    if(resource)assertResourceDelivery(value);
                    yes(value as T);
                }
                catch (error) {
                    fail(error);
                    no(error);
                }
                finally {
                    try {
                        finishResource();
                    }
                    catch (error) {
                        opaque(receiver);
                        fail(error);
                    }
                    roots.delete(reservation);
                    notify();
                }
            };
            try {
                if (typeof fn !== 'function' || isProxy(fn))
                    throw unconfirmed();
                if (cleanup)
                    resourceInventory(receiver,(apply(weakGet,resources,[receiver]) as ResourceContract|undefined)?.strictProxyGraph===true);
                raw = apply(fn, receiver, args);
                define(reservation, 'raw', { __proto__: null, value: raw } as PropertyDescriptor);
                if (isPromise(raw) && !isProxy(raw)) {
                    retain(raw, resource);
                    if (descriptor(raw as object, 'then'))
                        throw unconfirmed();
                    assertStandardIpcPromise(raw, 'ROOM_TURN_SOURCE_SDK_UNCONFIRMED');
                    apply(nativeThen, raw, [(value: unknown) => end(value, false), (error: unknown) => end(error, true)]);
                }
                else
                    end(raw, false);
            }
            catch (error) {
                define(reservation, 'failure', { __proto__: null, value: error } as PropertyDescriptor);
                fail(error);
                inventory(error);
                roots.delete(reservation);
                notify();
                no(error);
            }
        }));
    }
    function syncVoid(fn:Function,receiver:unknown,args:unknown[]):void {
        local();
        const reservation=create(null);
        roots.add(reservation);
        try {
            const raw=apply(fn,receiver,args);
            define(reservation,'raw',{__proto__:null,value:raw} as PropertyDescriptor);
            inventory(raw);
            if(raw!==undefined){opaque(raw);throw unconfirmed();}
            local();
        } catch(error) {
            define(reservation,'failure',{__proto__:null,value:error} as PropertyDescriptor);
            fail(error);inventory(error);throw error;
        } finally {roots.delete(reservation);notify();}
    }
    function root<T>(work: () => Promise<T>): Promise<T> {
        try {
            local();
        }
        catch (error) {
            return internal(new NativePromise<T>((_yes, no) => no(error)));
        }
        const row = create(null);
        roots.add(row);
        return internal(new NativePromise<T>((yes, no) => {
            try {
                const raw = work();
                define(row, 'raw', { __proto__: null, value: raw } as PropertyDescriptor);
                internal(raw);
                assertStandardIpcPromise(raw, 'ROOM_TURN_SOURCE_ROOT_UNCONFIRMED');
                apply(nativeThen, raw, [(value: T) => {
                        inventory(value);
                        roots.delete(row);
                        notify();
                        yes(value);
                    }, (error: unknown) => {
                        inventory(error);
                        roots.delete(row);
                        notify();
                        no(error);
                    }]);
            }
            catch (error) {
                inventory(error);
                roots.delete(row);
                notify();
                no(error);
            }
        }));
    }
    const seal = () => {
        sealed = true;
    };
    function drain(): Promise<void> {
        seal();
        if (closing)
            return closing;
        closing = internal(new NativePromise<void>((yes, no) => {
            const check = () => {
                if (roots.size || tails.size)
                    return;
                waiters.delete(check);
                if (unknown.size || heldResources.size)
                    no(Error('ROOM_TURN_SOURCE_SDK_UNCONFIRMED', { cause: failure }));
                else if (failed)
                    no(failure);
                else
                    yes();
            };
            waiters.add(check);
            check();
        }));
        return closing;
    }
    // Joins only already-owned producers and raw tails. The resource owner
    // closes its fixed acquired Native resource next, then calls drain().
    const waitKnown=():Promise<void>=>internal(new NativePromise<void>((yes,no)=>{
        const check=()=>{
            if(roots.size||tails.size)return;
            waiters.delete(check);
            if(unknown.size)no(unconfirmed());
            else if(failed)no(failure);
            else yes();
        };
        waiters.add(check);check();
    }));
    // Read-only physical inventory. A known rejected business result keeps its
    // original first cause and effect fence, but is not an immortal resource.
    const assertPhysicalKnown=()=>{if(roots.size||tails.size||heldResources.size||unknown.size)throw unconfirmed();};
    const waitPhysicalKnown=():Promise<void>=>internal(new NativePromise<void>((yes,no)=>{
        const check=()=>{
            if(roots.size||tails.size)return;
            waiters.delete(check);
            if(unknown.size||heldResources.size)no(unconfirmed());else yes();
        };
        waiters.add(check);check();
    }));
    const result = freeze({ current: local, local, accepted: () => {
            if (failed)
                throw failure;
        }, root, sdk, syncVoid,waitPhysicalKnown,assertPhysicalKnown,
        consumeResource: <T>(fn: Function, resource: object, args: unknown[]): Promise<T> => {
            if (!apply(weakGet, resources, [resource]))
                throw unconfirmed();
            return sdk<T>(fn, resource, args, undefined, true);
        }, inventory, seal, drain, waitKnown });
    apply(add, members, [result]);
    return result;
}
