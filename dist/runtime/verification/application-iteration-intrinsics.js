import { ownDataString } from './application-native-intrinsics.js';
import { types } from 'node:util';
const arrayIteratorFactory = Array.prototype[Symbol.iterator];
const arrayIteratorPrototype = Object.getPrototypeOf(arrayIteratorFactory.call([]));
const arrayIteratorNext = arrayIteratorPrototype.next;
const mapValues = Map.prototype.values;
const mapIteratorPrototype = Object.getPrototypeOf(mapValues.call(new Map()));
const mapIteratorNext = mapIteratorPrototype.next;
const apply = Reflect.apply;
const NativeSet = Set;
const NativeMap = Map;
const NativeWeakMap = WeakMap;
const NativeWeakSet = WeakSet;
const setAdd = Set.prototype.add;
const setHas = Set.prototype.has;
const setDelete = Set.prototype.delete;
const weakHas = WeakSet.prototype.has;
const weakAdd = WeakSet.prototype.add;
const weakDelete = WeakSet.prototype.delete;
const arrayIsArray = Array.isArray;
const arrayPrototype = Array.prototype;
const getPrototypeOf = Object.getPrototypeOf;
const getOwnPropertyDescriptors = Object.getOwnPropertyDescriptors;
const ownKeys = Reflect.ownKeys;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const hasOwn = Object.prototype.hasOwnProperty;
const NativeError = Error;
const isProxy = types.isProxy;
const numberIsSafeInteger = Number.isSafeInteger;
const defineProperty = Object.defineProperty;
function wrapIterator(iterator, nextMethod) {
    return {
        next() { return apply(nextMethod, iterator, []); },
        [Symbol.iterator]() { return this; },
    };
}
function append(values, value) { defineProperty(values, ownDataString(values.length), { __proto__: null, value, enumerable: true, writable: true, configurable: true }); }
/** Iterate an array through the iterator factory and next method captured at module load. */
export function capturedArrayIterator(values) {
    const iterator = apply(arrayIteratorFactory, values, []);
    return wrapIterator(iterator, arrayIteratorNext);
}
/** Iterate Map values through separately captured factory and iterator next methods. */
export function capturedMapValuesIterator(values) {
    const iterator = apply(mapValues, values, []);
    return wrapIterator(iterator, mapIteratorNext);
}
export function capturedArrayFind(values, predicate) {
    let index = 0;
    for (const value of capturedArrayIterator(values)) {
        if (predicate(value, index++))
            return value;
    }
    return undefined;
}
export function capturedArraySome(values, predicate) {
    let index = 0;
    for (const value of capturedArrayIterator(values))
        if (predicate(value, index++))
            return true;
    return false;
}
export function capturedArrayMap(values, project) {
    const result = [];
    let index = 0;
    for (const value of capturedArrayIterator(values))
        append(result, project(value, index++));
    return result;
}
export function capturedArrayFilter(values, predicate) {
    const result = [];
    let index = 0;
    for (const value of capturedArrayIterator(values))
        if (predicate(value, index++))
            append(result, value);
    return result;
}
/** Set(array) semantics without consulting the caller-replaceable Array iterator. */
export function setFromDenseArray(values) {
    if (!values || !arrayIsArray(values) || isProxy(values) || getPrototypeOf(values) !== arrayPrototype)
        throw new NativeError('application_array_shape');
    const descriptors = getOwnPropertyDescriptors(values), keys = ownKeys(descriptors), lengthDescriptor = getOwnPropertyDescriptor(descriptors, 'length');
    const lengthEntry = lengthDescriptor && apply(hasOwn, lengthDescriptor, ['value']) ? lengthDescriptor.value : undefined;
    const length = lengthEntry && apply(hasOwn, lengthEntry, ['value']) ? lengthEntry.value : undefined;
    if (!numberIsSafeInteger(length) || length < 0 || keys.length !== length + 1)
        throw new NativeError('application_array_shape');
    const result = new NativeSet();
    for (let index = 0; index < length; index++) {
        const entry = getOwnPropertyDescriptor(descriptors, ownDataString(index)), descriptor = entry && apply(hasOwn, entry, ['value']) ? entry.value : undefined;
        if (!descriptor || !apply(hasOwn, descriptor, ['value']) || descriptor.enumerable !== true)
            throw new NativeError('application_array_shape');
        apply(setAdd, result, [descriptor.value]);
    }
    return result;
}
/** Collection constructors captured before caller-controlled code can replace globals. */
export function createCapturedSet() { return new NativeSet(); }
export function createCapturedMap() { return new NativeMap(); }
export function createCapturedWeakMap() { return new NativeWeakMap(); }
export function createCapturedWeakSet() { return new NativeWeakSet(); }
export function capturedSetHas(set, value) { return apply(setHas, set, [value]); }
export function capturedSetAdd(set, value) { apply(setAdd, set, [value]); }
export function capturedSetDelete(set, value) { apply(setDelete, set, [value]); }
export function capturedWeakSetHas(set, value) { return apply(weakHas, set, [value]); }
export function capturedWeakSetAdd(set, value) { apply(weakAdd, set, [value]); }
export function capturedWeakSetDelete(set, value) { apply(weakDelete, set, [value]); }
