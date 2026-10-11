import { types } from 'node:util';
const isPromise = types.isPromise, isProxy = types.isProxy;
const ownDescriptor = Object.getOwnPropertyDescriptor, prototypeOf = Object.getPrototypeOf;
const nativePromise = Promise, promisePrototype = nativePromise.prototype;
const species = Symbol.species;
const initialSpecies = ownDescriptor(nativePromise, species);
/** Main-only precondition immediately before applying intrinsic Promise.then. */
export function assertStandardIpcPromise(value: unknown, error: string): asserts value is Promise<unknown> {
  if (!isPromise(value) || isProxy(value) || prototypeOf(value) !== promisePrototype) throw Error(error);
  const own = ownDescriptor(value, 'constructor'), inherited = ownDescriptor(promisePrototype, 'constructor');
  const currentSpecies = ownDescriptor(nativePromise, species);
  if (!inherited || !('value' in inherited) || inherited.value !== nativePromise
    || own && (!('value' in own) || own.value !== nativePromise)
    || !initialSpecies || !currentSpecies || 'value' in currentSpecies || 'value' in initialSpecies
    || currentSpecies.get !== initialSpecies.get || currentSpecies.set !== initialSpecies.set
    || currentSpecies.enumerable !== initialSpecies.enumerable || currentSpecies.configurable !== initialSpecies.configurable) throw Error(error);
}
