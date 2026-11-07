import { types } from 'node:util';
import { assertStandardIpcPromise } from './native-ipc-promise.js';
import { createRoomTurnCustody } from './original-sdk-custody.js';
import type * as OriginalProcessSdk from './original-process-sdk.js';
const apply = Reflect.apply, descriptor = Object.getOwnPropertyDescriptor, keys = Reflect.ownKeys;
const create = Object.create, define = Object.defineProperty, freeze = Object.freeze, own = Object.hasOwn;
const NativePromise = Promise, nativeThen = Promise.prototype.then, isProxy = types.isProxy;
const exportNames = [
    'readOriginalSourceProcessPhysicalFate', 'createOriginalSourceProcess', 'createOriginalSourceWorker',
    'createOriginalHostWorker', 'postOriginalHostWorkerRequest', 'retainOriginalToolProcessValue', 'retainOriginalToolProcessFileOperation', 'readCurrentOriginalHostWorkerTicket', 'readOriginalHostWorkerPhysicalFate',
    'spawnOriginalToolProcess', 'createOriginalToolWorker', 'runOriginalBoundedReadonlyLeaf', 'spawnSyncOriginalToolProcess',
    'listenOriginalToolProcess', 'sealOriginalToolProcessListeners', 'waitOriginalToolProcessPhysical',
    'readOriginalToolProcessKernelObservation', 'readOriginalToolProcessPhysicalReceipt', 'readOptionalOriginalToolProcessPhysicalReceipt',
    'terminateOriginalToolProcess',
] as const;
const consumeExports = () => { };
/** Fixed module loading, not a verifier or a caller-selected SDK. The Registry
 * and Host have already reserved their invocation; the actual Worker reserves
 * its own original P only after this component's visible loader tails close. */
export async function loadOriginalProcessSdk(): Promise<typeof OriginalProcessSdk> {
    const custody = createRoomTurnCustody();
    const held = create(null) as Record<string, unknown>;
    let result!: typeof OriginalProcessSdk;
    const raw = custody.root(async () => {
        const imported = import('./original-process-sdk.js');
        define(held, 'raw', { __proto__: null, value: imported } as PropertyDescriptor);
        assertStandardIpcPromise(imported, 'TOOL_PROCESS_SDK_IMPORT_UNCONFIRMED');
        function children(): void {
            const names = keys(imported);
            for (let i = 0; i < names.length; i++) {
                const name = names[i]!, row = descriptor(imported, name);
                if (name === 'constructor' && row && own(row, 'value') && row.value === NativePromise)
                    continue;
                if (!row || !own(row, 'value'))
                    throw Error('TOOL_PROCESS_SDK_IMPORT_UNCONFIRMED');
                custody.inventory(row.value);
            }
        }
        children();
        const namespace = await new NativePromise<typeof OriginalProcessSdk>((yes, no) => {
            const observer = apply(nativeThen, imported, [(value: typeof OriginalProcessSdk) => {
                    define(held, 'namespace', { __proto__: null, value } as PropertyDescriptor);
                    try {
                        children();
                        yes(value);
                    }
                    catch (error) {
                        no(error);
                    }
                }, (error: unknown) => {
                    custody.inventory(error);
                    try {
                        children();
                    }
                    catch (secondary) {
                        custody.inventory(secondary);
                    }
                    no(error);
                }]);
            define(held, 'observer', { __proto__: null, value: observer } as PropertyDescriptor);
            custody.inventory(observer);
        });
        if (!namespace || typeof namespace !== 'object' || isProxy(namespace))
            throw Error('TOOL_PROCESS_SDK_IMPORT_UNCONFIRMED');
        const names = keys(namespace), out = create(null);
        for (let i = 0; i < names.length; i++) {
            const name = names[i]!, row = descriptor(namespace, name);
            if (!row)
                throw Error('TOOL_PROCESS_SDK_IMPORT_UNCONFIRMED');
            if (typeof name === 'string' && exportNames.includes(name as typeof exportNames[number])) {
                // A real ESM namespace uses data exports. esbuild's fixed module shell uses
                // its own getters. Read only these exact SDK export slots as SDK operations,
                // box the raw function before Promise resolution, and scan its own graph.
                const shell = await custody.sdk<object>(() => {
                    const value = own(row, 'value') ? row.value : typeof row.get === 'function' && !isProxy(row.get) ? apply(row.get, namespace, []) : undefined;
                    define(held, name, { __proto__: null, value } as PropertyDescriptor);
                    if (typeof value !== 'function' || isProxy(value))
                        throw Error('TOOL_PROCESS_SDK_IMPORT_UNCONFIRMED');
                    return freeze(Object.assign(create(null), { value }));
                }, undefined, [], { accept: value => !!value && typeof value === 'object' && !isProxy(value), consumer: consumeExports });
                const value = (shell as {
                    value: Function;
                }).value;
                define(out, name, { __proto__: null, value, enumerable: true } as PropertyDescriptor);
                await custody.consumeResource(consumeExports, shell, []);
            }
            else {
                if (!own(row, 'value'))
                    throw Error('TOOL_PROCESS_SDK_IMPORT_UNCONFIRMED');
                custody.inventory(row.value);
            }
        }
        for (let i = 0; i < exportNames.length; i++)
            if (!own(out, exportNames[i]!))
                throw Error('TOOL_PROCESS_SDK_IMPORT_UNCONFIRMED');
        result = freeze(out) as typeof OriginalProcessSdk;
    });
    let failure: {
        error: unknown;
    } | undefined;
    try {
        await raw;
    }
    catch (error) {
        failure = { error };
    }
    // Failed fixed-module loading can also have accepted visible SDK children.
    // Preserve that first cause while joining the same inventory on both paths.
    try {
        await custody.waitPhysicalKnown();
    }
    catch (error) {
        if (!failure)
            failure = { error };
        else if (error !== failure.error)
            failure = { error: new AggregateError([failure.error, error], 'TOOL_PROCESS_SDK_IMPORT_AND_DRAIN_FAILED', { cause: failure.error }) };
    }
    if (failure)
        throw failure.error;
    return result;
}
