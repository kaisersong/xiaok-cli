import {ownDataString} from './application-native-intrinsics.js';
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
function wrapIterator<T>(iterator: object, nextMethod: Function): IterableIterator<T> {
    return {
        next() { return apply(nextMethod, iterator, []) as IteratorResult<T>; },
        [Symbol.iterator]() { return this; },
    };
}
function append<T>(values: T[], value: T): void { defineProperty(values, ownDataString(values.length), ({ __proto__: null, value, enumerable: true, writable: true, configurable: true } as PropertyDescriptor)); }
/** Iterate an array through the iterator factory and next method captured at module load. */
export function capturedArrayIterator<T>(values: readonly T[]): IterableIterator<T> {
    const iterator = apply(arrayIteratorFactory, values, []) as object;
    return wrapIterator<T>(iterator, arrayIteratorNext);
}
/** Iterate Map values through separately captured factory and iterator next methods. */
export function capturedMapValuesIterator<K, V>(values: Map<K, V>): IterableIterator<V> {
    const iterator = apply(mapValues, values, []) as object;
    return wrapIterator<V>(iterator, mapIteratorNext);
}
export function capturedArrayFind<T>(values: readonly T[], predicate: (value: T, index: number) => boolean): T | undefined { let index = 0; for (const value of capturedArrayIterator(values)) {
    if (predicate(value, index++))
        return value;
} return undefined; }
export function capturedArraySome<T>(values: readonly T[], predicate: (value: T, index: number) => boolean): boolean { let index = 0; for (const value of capturedArrayIterator(values))
    if (predicate(value, index++))
        return true; return false; }
export function capturedArrayMap<T, U>(values: readonly T[], project: (value: T, index: number) => U): U[] { const result: U[] = []; let index = 0; for (const value of capturedArrayIterator(values))
    append(result, project(value, index++)); return result; }
export function capturedArrayFilter<T>(values: readonly T[], predicate: (value: T, index: number) => boolean): T[] { const result: T[] = []; let index = 0; for (const value of capturedArrayIterator(values))
    if (predicate(value, index++))
        append(result, value); return result; }
/** Set(array) semantics without consulting the caller-replaceable Array iterator. */
export function setFromDenseArray<T>(values: readonly T[]): Set<T> {
    if (!values || !arrayIsArray(values) || isProxy(values) || getPrototypeOf(values) !== arrayPrototype)
        throw new NativeError('application_array_shape');
    const descriptors = getOwnPropertyDescriptors(values), keys = ownKeys(descriptors), lengthDescriptor = getOwnPropertyDescriptor(descriptors, 'length');
    const lengthEntry = lengthDescriptor && apply(hasOwn, lengthDescriptor, ['value']) ? lengthDescriptor.value : undefined;
    const length = lengthEntry && apply(hasOwn, lengthEntry, ['value']) ? lengthEntry.value : undefined;
    if (!numberIsSafeInteger(length) || length < 0 || keys.length !== length + 1)
        throw new NativeError('application_array_shape');
    const result = new NativeSet<T>();
    for (let index = 0; index < length; index++) {
        const entry = getOwnPropertyDescriptor(descriptors, ownDataString(index)), descriptor = entry && apply(hasOwn, entry, ['value']) ? entry.value : undefined;
        if (!descriptor || !apply(hasOwn, descriptor, ['value']) || descriptor.enumerable !== true)
            throw new NativeError('application_array_shape');
        apply(setAdd, result, [descriptor.value]);
    }
    return result;
}
/** Collection constructors captured before caller-controlled code can replace globals. */
export function createCapturedSet<T>(): Set<T> { return new NativeSet<T>(); }
export function createCapturedMap<K, V>(): Map<K, V> { return new NativeMap<K, V>(); }
export function createCapturedWeakMap<K extends object, V>(): WeakMap<K, V> { return new NativeWeakMap<K, V>(); }
export function createCapturedWeakSet<T extends object>(): WeakSet<T> { return new NativeWeakSet<T>(); }
export function capturedSetHas<T>(set: Set<T>, value: T): boolean { return apply(setHas, set, [value]) as boolean; }
export function capturedSetAdd<T>(set: Set<T>, value: T): void { apply(setAdd, set, [value]); }
export function capturedSetDelete<T>(set: Set<T>, value: T): void { apply(setDelete, set, [value]); }
export function capturedWeakSetHas<T extends object>(set: WeakSet<T>, value: T): boolean { return apply(weakHas, set, [value]) as boolean; }
export function capturedWeakSetAdd<T extends object>(set: WeakSet<T>, value: T): void { apply(weakAdd, set, [value]); }
export function capturedWeakSetDelete<T extends object>(set: WeakSet<T>, value: T): void { apply(weakDelete, set, [value]); }
