// Ordinary callback slot/return boundary; no producer/permission/profile authority.
import { types } from 'node:util';
const isProxy = types.isProxy, isPromise = types.isPromise;
const ownDescriptor = Object.getOwnPropertyDescriptor, prototypeOf = Object.getPrototypeOf;
const NativePromise = Promise, promisePrototype = NativePromise.prototype;
const species = Symbol.species;
const initialSpecies = ownDescriptor(NativePromise, species);
const environmentWitness = new NativePromise(resolve => resolve());
export function assertDirectHookReturn(value) {
    if (!isPromise(value) || isProxy(value) || prototypeOf(value) !== promisePrototype)
        throw Error('hook_callback_return_unconfirmed');
    const own = ownDescriptor(value, 'constructor'), inherited = ownDescriptor(promisePrototype, 'constructor');
    const currentSpecies = ownDescriptor(NativePromise, species);
    if (!inherited || !('value' in inherited) || inherited.value !== NativePromise
        || own && (!('value' in own) || own.value !== NativePromise)
        || !initialSpecies || !currentSpecies || 'value' in currentSpecies || 'value' in initialSpecies
        || currentSpecies.get !== initialSpecies.get || currentSpecies.set !== initialSpecies.set
        || currentSpecies.enumerable !== initialSpecies.enumerable || currentSpecies.configurable !== initialSpecies.configurable)
        throw Error('hook_callback_return_unconfirmed');
}
export function captureDirectHookSlot(receiver, method, optional) {
    // Ambient safety is checked before receiver/method lookup, arguments or producer.
    // It cannot attest arbitrary producer bodies or undisclosed inner work.
    assertDirectHookReturn(environmentWitness);
    if (isProxy(receiver))
        throw Error('hook_callback_slot_unconfirmed');
    const slot = ownDescriptor(receiver, method);
    if (!slot && optional)
        return undefined;
    if (!slot || !('value' in slot))
        throw Error('hook_callback_slot_unconfirmed');
    if (slot.value === undefined && optional)
        return undefined;
    if (typeof slot.value !== 'function' || isProxy(slot.value))
        throw Error('hook_callback_slot_unconfirmed');
    return slot.value;
}
