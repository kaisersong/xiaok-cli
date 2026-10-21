import { types } from 'node:util';
// Private startup identities. Check with captured readers and index loops before
// any registration code can invoke a replaced iterator, method or getter.
const NativeError = Error;
const globalObject = globalThis;
const descriptor = Reflect.getOwnPropertyDescriptor, prototype = Object.getPrototypeOf, ownKeys = Reflect.ownKeys;
const sameValue = Object.is;
const hasOwn = Object.hasOwn;
const bindings = ['Object', 'Array', 'String', 'RegExp', 'Map', 'Set', 'WeakMap', 'Number', 'Math', 'JSON', 'Reflect'];
function captureDescriptor(target, key) { const value = descriptor(target, key); return { value, data: value !== undefined && hasOwn(value, 'value') }; }
const globalDescriptors = bindings.map(key => ({ key, ...captureDescriptor(globalObject, key) }));
const globalPrototype = prototype(globalObject);
const arrayIterator = prototype([][Symbol.iterator]());
const mapIterator = prototype(new Map().keys()), setIterator = prototype(new Set().values());
const targets = [Object, Array, String, RegExp, Map, Set, WeakMap, Number, Math, JSON, Reflect,
    Array.prototype, String.prototype, RegExp.prototype, Map.prototype, Set.prototype, WeakMap.prototype,
    arrayIterator, mapIterator, setIterator, prototype(arrayIterator)];
const populations = targets.map(target => { const keys = ownKeys(target), descriptors = keys.map(key => descriptor(target, key)); return { target, parent: prototype(target), keys, descriptors, data: descriptors.map(value => value !== undefined && hasOwn(value, 'value')) }; });
const weakMapBinding = globalDescriptors[6];
const weakMapPopulation = populations[16];
const originalEdges = [{ target: types, key: 'isProxy', ...captureDescriptor(types, 'isProxy') },
    { target: Function.prototype, key: 'call', ...captureDescriptor(Function.prototype, 'call') },
    { target: Function.prototype, key: 'apply', ...captureDescriptor(Function.prototype, 'apply') }];
function fail() { throw new NativeError('application_registration_changed'); }
// Captured native descriptors have complete data or accessor shapes. Compare
// every field in that shape without reading an absent inherited property.
function sameDescriptor(actual, expected, expectedData) {
    if (actual === undefined || expected === undefined)
        return actual === expected;
    const data = hasOwn(actual, 'value');
    if (data !== expectedData)
        return false;
    if (data)
        return sameValue(actual.value, expected.value) && actual.writable === expected.writable &&
            actual.enumerable === expected.enumerable && actual.configurable === expected.configurable;
    return sameValue(actual.get, expected.get) && sameValue(actual.set, expected.set) &&
        actual.enumerable === expected.enumerable && actual.configurable === expected.configurable;
}
function checkPopulation(entry) {
    if (prototype(entry.target) !== entry.parent)
        fail();
    const keys = ownKeys(entry.target);
    if (keys.length !== entry.keys.length)
        fail();
    for (let i = 0; i < keys.length; i++) {
        if (keys[i] !== entry.keys[i] || !sameDescriptor(descriptor(entry.target, entry.keys[i]), entry.descriptors[i], entry.data[i]))
            fail();
    }
}
/** No caller-supplied descriptors, exceptions or authorization claims. */
export function assertRegistrationIntrinsics() {
    if (prototype(globalObject) !== globalPrototype)
        fail();
    for (let i = 0; i < globalDescriptors.length; i++) {
        const entry = globalDescriptors[i];
        if (!sameDescriptor(descriptor(globalObject, entry.key), entry.value, entry.data))
            fail();
    }
    for (let i = 0; i < populations.length; i++)
        checkPopulation(populations[i]);
    for (let i = 0; i < originalEdges.length; i++) {
        const entry = originalEdges[i];
        if (!sameDescriptor(descriptor(entry.target, entry.key), entry.value, entry.data))
            fail();
    }
}
/** Check the native-brand reader before it can turn a real brand into absence. */
export function assertRegistrationWeakMapIntrinsics() {
    if (!sameDescriptor(descriptor(globalObject, weakMapBinding.key), weakMapBinding.value, weakMapBinding.data))
        fail();
    checkPopulation(weakMapPopulation);
}
