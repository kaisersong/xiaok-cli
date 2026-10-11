import {ownDataString} from './application-native-intrinsics.js';
import { capturedArrayIterator, createCapturedSet } from './application-iteration-intrinsics.js';
import { types } from 'node:util';
const isProxy = types.isProxy;
const arrayIsArray = Array.isArray;
const getPrototypeOf = Object.getPrototypeOf;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const getOwnPropertyDescriptors = Object.getOwnPropertyDescriptors;
const objectCreate = Object.create;
const defineProperty = Object.defineProperty;
const freeze = Object.freeze;
const ownKeys = Reflect.ownKeys;
const apply = Reflect.apply;
const reflectGet = Reflect.get;
const hasOwn = Object.prototype.hasOwnProperty;
const objectEntries = Object.entries;
const objectFromEntries = Object.fromEntries;
const arraySome = Array.prototype.some;
const arrayIncludes = Array.prototype.includes;
const setHas = Set.prototype.has;
const setAdd = Set.prototype.add;
const setDelete = Set.prototype.delete;
const stringCharCodeAt = String.prototype.charCodeAt;
const numberIsSafeInteger = Number.isSafeInteger;
const numberIsFinite = Number.isFinite;
const jsonStringify = JSON.stringify;
const NativeError = Error;
const NativeString = String;
const objectPrototype = Object.prototype;
const arrayPrototype = Array.prototype;
const MAXIMUM_DESCRIPTOR_KEYS = 8000000;
function nativeOwn(value: object, key: PropertyKey): boolean { return apply(hasOwn, value, [key]) as boolean; }
function fail(error: unknown): never { const label = typeof error === 'string' ? error : typeof error === 'number' || typeof error === 'boolean' || typeof error === 'bigint' || typeof error === 'symbol' ? NativeString(error) : 'application_data'; throw new NativeError(label); }
function descriptorValue(descriptors: PropertyDescriptorMap, key: PropertyKey): unknown {
    if (!nativeOwn(descriptors, key))
        return undefined;
    const entry = getOwnPropertyDescriptor(descriptors, key);
    if (!entry || !nativeOwn(entry, 'value'))
        return undefined;
    return apply(reflectGet, undefined, [entry, 'value', entry]);
}
function append<T>(target: T[], value: T): void { defineProperty(target, `${target.length}`, ({ __proto__: null, value, enumerable: true, writable: true, configurable: true } as PropertyDescriptor)); }
/** Read one control field without enumerating the caller's other fields. */
export function readApplicationOwnDataField(value: unknown, key: string, error: string): Readonly<{
    present: boolean;
    kind: 'missing' | 'data' | 'accessor';
    value: unknown;
}> {
    const reject = () => fail(error);
    if (typeof key !== 'string' || typeof error !== 'string')
        return reject();
    if (!value || typeof value !== 'object' || isProxy(value))
        return reject();
    if (arrayIsArray(value))
        return reject();
    let prototype: object | null;
    try {
        prototype = getPrototypeOf(value);
    }
    catch {
        return reject();
    }
    if (prototype !== objectPrototype && prototype !== null)
        return reject();
    let descriptor: PropertyDescriptor | undefined;
    try {
        descriptor = getOwnPropertyDescriptor(value, key);
    }
    catch {
        return reject();
    }
    const present = descriptor !== undefined;
    const kind = !present ? 'missing' : nativeOwn(descriptor!, 'value') ? 'data' : 'accessor';
    const result = objectCreate(null) as {
        present: boolean;
        kind: 'missing' | 'data' | 'accessor';
        value: unknown;
    };
    defineProperty(result, 'present', ({ __proto__: null, value: present, enumerable: true, writable: false, configurable: false } as PropertyDescriptor));
    defineProperty(result, 'kind', ({ __proto__: null, value: kind, enumerable: true, writable: false, configurable: false } as PropertyDescriptor));
    defineProperty(result, 'value', ({ __proto__: null, value: kind === 'data' ? apply(reflectGet, undefined, [descriptor!, 'value', descriptor!]) : undefined, enumerable: true, writable: false, configurable: false } as PropertyDescriptor));
    return freeze(result);
}
/** Inspect own descriptors without evaluating input accessors or Proxy traps. */
export function applicationDataDescriptors(value: unknown, maximumKeys = 65536, error = 'application_data'): PropertyDescriptorMap {
    if (typeof maximumKeys !== 'number' || !numberIsSafeInteger(maximumKeys) || maximumKeys < 0 || maximumKeys > MAXIMUM_DESCRIPTOR_KEYS || typeof error !== 'string')
        fail(typeof error === 'string' ? error : 'application_data');
    if (!value || typeof value !== 'object' || isProxy(value))
        fail(safeErrorLabel(error));
    const array = arrayIsArray(value), prototype = getPrototypeOf(value);
    if (array ? prototype !== arrayPrototype : prototype !== objectPrototype && prototype !== null)
        fail(safeErrorLabel(error));
    const keys = ownKeys(value);
    if (keys.length > maximumKeys || apply(arraySome, keys, [key => typeof key !== 'string']))
        fail(safeErrorLabel(error));
    const source = getOwnPropertyDescriptors(value), result = objectCreate(null) as PropertyDescriptorMap;
    for (const key of capturedArrayIterator(keys)) {
        const descriptor = nativeOwn(source,key) ? source[key as string] as PropertyDescriptor : undefined;
        if (!descriptor || !nativeOwn(descriptor, 'value'))
            fail(safeErrorLabel(error));
        result[key as string] = descriptor;
    }
    return result;
}
/** Rebuild an ordinary object from captured dense entries without native iterator lookup. */
export function applicationDataFromEntries(entries: readonly (readonly [
    string,
    unknown
])[]): Record<string, unknown> {
    const result = objectCreate(objectPrototype) as Record<string, unknown>;
    for (const entry of capturedArrayIterator(entries))
        defineProperty(result, entry[0], ({ __proto__: null, value: entry[1], enumerable: true, writable: true, configurable: true } as PropertyDescriptor));
    return result;
}
function safeErrorLabel(error: unknown): string {
    if (error === null || error === undefined || typeof error === 'string' || typeof error === 'number' || typeof error === 'boolean' || typeof error === 'bigint' || typeof error === 'symbol')
        return error as string;
    return 'application_data';
}
/** Count canonical JSON bytes before allocating escaped strings or a full clone.
 * This is only a data bound; it supplies no execution or approval authority. */
export function captureApplicationData(raw: unknown, limits: {
    maximumBytes: number;
    maximumNodes: number;
    maximumDepth?: number;
    invalid: string;
    limit: string;
}): any {
    const readLimit = (key: 'maximumBytes' | 'maximumNodes' | 'maximumDepth' | 'invalid' | 'limit', required: boolean): unknown => {
        const field = readApplicationOwnDataField(limits, key, 'application_data_budget');
        if (field.kind === 'accessor' || required && !field.present)
            fail('application_data_budget');
        return apply(reflectGet, undefined, [field, 'value', field]);
    };
    const maximumBytes = readLimit('maximumBytes', true), maximumNodes = readLimit('maximumNodes', true), depthField = readLimit('maximumDepth', false), invalidValue = readLimit('invalid', true), limitValue = readLimit('limit', true);
    if (typeof invalidValue !== 'string' || typeof limitValue !== 'string')
        fail('application_data_budget');
    const invalid = invalidValue, limit = limitValue, maximumDepth = depthField === undefined ? 64 : depthField;
    if (!numberIsSafeInteger(maximumBytes) || (maximumBytes as number) < 1 || (maximumBytes as number) > 128 * 1024 ** 2 || !numberIsSafeInteger(maximumNodes) || (maximumNodes as number) < 1 || (maximumNodes as number) > MAXIMUM_DESCRIPTOR_KEYS || !numberIsSafeInteger(maximumDepth) || (maximumDepth as number) < 0 || (maximumDepth as number) > 128)
        fail('application_data_budget');
    const seen = createCapturedSet<object>();
    let nodes = 0, bytes = 0;
    const charge = (count: number) => { bytes += count; if (bytes > (maximumBytes as number))
        fail(limit); };
    const string = (value: string) => {
        charge(2);
        for (let i = 0; i < value.length; i++) {
            const code = apply(stringCharCodeAt, value, [i]) as number;
            if (code === 34 || code === 92)
                charge(2);
            else if (code < 32)
                charge(apply(arrayIncludes, [8, 9, 10, 12, 13], [code]) ? 2 : 6);
            else if (code >= 0xd800 && code <= 0xdbff && i + 1 < value.length && (apply(stringCharCodeAt, value, [i + 1]) as number) >= 0xdc00 && (apply(stringCharCodeAt, value, [i + 1]) as number) <= 0xdfff) {
                charge(4);
                i++;
            }
            else if (code >= 0xd800 && code <= 0xdfff)
                charge(6);
            else
                charge(code < 128 ? 1 : code < 2048 ? 2 : 3);
        }
    };
    const copy = (value: unknown, depth: number): any => {
        if (++nodes > (maximumNodes as number) || depth > (maximumDepth as number))
            fail(invalid);
        if (value === null) {
            charge(4);
            return value;
        }
        if (typeof value === 'string') {
            string(value);
            return value;
        }
        if (typeof value === 'boolean') {
            charge(value ? 4 : 5);
            return value;
        }
        if (typeof value === 'number' && numberIsFinite(value)) {
            charge(jsonStringify(value).length);
            return value;
        }
        if (!value || typeof value !== 'object' || isProxy(value) || apply(setHas, seen, [value]))
            fail(invalid);
        const keys = ownKeys(value);
        if (keys.length > (maximumNodes as number) - nodes + 1)
            fail(invalid);
        const descriptors = applicationDataDescriptors(value, (maximumNodes as number) - nodes + 1, invalid), array = arrayIsArray(value);
        apply(setAdd, seen, [value]);
        try {
            charge(2);
            if (array) {
                const lengthField = descriptors.length as PropertyDescriptor | undefined, length = lengthField && nativeOwn(lengthField, 'value') ? apply(reflectGet, undefined, [lengthField, 'value', lengthField]) : undefined;
                if (!numberIsSafeInteger(length) || (length as number) < 0 || (length as number) > (maximumNodes as number) - nodes || keys.length !== (length as number) + 1)
                    fail(invalid);
                const result: any[] = [];
                for (let i = 0; i < (length as number); i++) {
                    if (i)
                        charge(1);
                    const item = descriptors[ownDataString(i)] as PropertyDescriptor | undefined, child = item && nativeOwn(item, 'value') ? apply(reflectGet, undefined, [item, 'value', item]) : undefined;
                    append(result, copy(child, depth + 1));
                }
                return result;
            }
            const keysInOrder = ownKeys(descriptors), copied = objectCreate(objectPrototype) as Record<string, unknown>;
            for (let i = 0; i < keysInOrder.length; i++) {
                const key = keysInOrder[i] as string, descriptor = descriptors[key] as PropertyDescriptor;
                if (i) charge(1);
                string(key);
                charge(1);
                const child = descriptor && nativeOwn(descriptor, 'value') ? apply(reflectGet, undefined, [descriptor, 'value', descriptor]) : undefined;
                defineProperty(copied, key, ({ __proto__: null, value: copy(child, depth + 1), enumerable: true, writable: true, configurable: true } as PropertyDescriptor));
            }
            return copied;
        }
        finally {
            apply(setDelete, seen, [value]);
        }
    };
    return copy(raw, 0);
}
