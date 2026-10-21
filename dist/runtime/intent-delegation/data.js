import { ownDataBufferByteLength, ownDataString } from '../verification/application-native-intrinsics.js';
import { types } from 'node:util';
import { capturedSetAdd, capturedSetDelete, capturedSetHas, createCapturedSet } from '../verification/application-iteration-intrinsics.js';
const arrayIsArray = Array.isArray;
const numberIsFinite = Number.isFinite;
const numberIsSafeInteger = Number.isSafeInteger;
const getPrototypeOf = Object.getPrototypeOf;
const getOwnPropertyDescriptors = Object.getOwnPropertyDescriptors;
const ownKeys = Reflect.ownKeys;
const hasOwn = Object.prototype.hasOwnProperty;
const objectCreate = Object.create;
const defineProperty = Object.defineProperty;
const stringify = JSON.stringify;
const isProxy = types.isProxy;
const arrayPrototype = Array.prototype;
const objectPrototype = Object.prototype;
const apply = Reflect.apply;
/** Capture plain own data without running caller getters, iterators or mutable Array methods. */
export function captureIntentData(raw) {
    const seen = createCapturedSet();
    function copy(value, depth) {
        if (value === null || typeof value === 'string' || typeof value === 'boolean')
            return value;
        if (typeof value === 'number' && numberIsFinite(value))
            return value;
        if (!value || typeof value !== 'object' || depth > 128 || isProxy(value) || capturedSetHas(seen, value))
            throw Error('intent_commit_data');
        const array = arrayIsArray(value), prototype = getPrototypeOf(value);
        if (array ? prototype !== arrayPrototype : prototype !== objectPrototype && prototype !== null)
            throw Error('intent_commit_data');
        const keys = ownKeys(value), descriptors = getOwnPropertyDescriptors(value);
        for (let i = 0; i < keys.length; i++)
            if (typeof keys[i] !== 'string')
                throw Error('intent_commit_accessor');
        capturedSetAdd(seen, value);
        try {
            if (array) {
                const lengthDescriptor = apply(hasOwn, descriptors, ['length']) ? descriptors.length : undefined;
                const length = lengthDescriptor && apply(hasOwn, lengthDescriptor, ['value']) ? lengthDescriptor.value : undefined;
                if (!numberIsSafeInteger(length) || length < 0 || keys.length !== length + 1)
                    throw Error('intent_commit_array');
                const result = [];
                for (let index = 0; index < length; index++) {
                    const key = ownDataString(index);
                    const descriptor = apply(hasOwn, descriptors, [key]) ? descriptors[key] : undefined;
                    if (!descriptor || !apply(hasOwn, descriptor, ['value']))
                        throw Error('intent_commit_data');
                    defineProperty(result, ownDataString(index), { __proto__: null, value: copy(descriptor.value, depth + 1), enumerable: true, writable: true, configurable: true });
                }
                return result;
            }
            const result = objectCreate(objectPrototype);
            for (let i = 0; i < keys.length; i++) {
                const key = keys[i];
                if (typeof key !== 'string')
                    throw Error('intent_commit_accessor');
                const descriptor = apply(hasOwn, descriptors, [key]) ? descriptors[key] : undefined;
                if (!descriptor || !apply(hasOwn, descriptor, ['value']))
                    throw Error('intent_commit_accessor');
                if (descriptor.value !== undefined)
                    defineProperty(result, key, { __proto__: null, value: copy(descriptor.value, depth + 1), enumerable: true, writable: true, configurable: true });
            }
            return result;
        }
        finally {
            capturedSetDelete(seen, value);
        }
    }
    const result = copy(raw, 0);
    if (ownDataBufferByteLength(stringify(result)) > 16 * 1024 * 1024)
        throw Error('intent_commit_limit');
    return result;
}
/** Ordinary nullable-array length DATA only; not native admission or a journal validator. */
export function nativeJournalLengthData(value) {
    if (value === undefined || value === null)
        return undefined;
    if (!Array.isArray(value))
        throw Error('intent_native_journal');
    return value.length;
}
