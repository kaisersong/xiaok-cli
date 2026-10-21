import { types } from 'node:util';
const own = Object.getOwnPropertyDescriptor, prototypeOf = Object.getPrototypeOf;
export const ObserverNativePromise = Promise;
const prototype = ObserverNativePromise.prototype, species = Symbol.species;
const initialSpecies = own(ObserverNativePromise, species), initialThen = own(prototype, 'then');
// Same approved pre-producer descriptor witness as desktop ipc-native-promise,
// kept runtime-local so CLI never imports Desktop. Realm must start standard.
const witness = new ObserverNativePromise<void>(resolve => resolve());
export function assertObserverPromiseAmbient(): void {
  const globalPromise = own(globalThis, 'Promise');
  const constructor = own(prototype, 'constructor'), currentSpecies = own(ObserverNativePromise, species), currentThen = own(prototype, 'then');
  if (!globalPromise || !('value' in globalPromise) || globalPromise.value !== ObserverNativePromise
    || !types.isPromise(witness) || types.isProxy(witness) || prototypeOf(witness) !== prototype
    || !constructor || !('value' in constructor) || constructor.value !== ObserverNativePromise
    || !initialSpecies || !currentSpecies || 'value' in initialSpecies || 'value' in currentSpecies
    || currentSpecies.get !== initialSpecies.get || currentSpecies.set !== initialSpecies.set
    || currentSpecies.enumerable !== initialSpecies.enumerable || currentSpecies.configurable !== initialSpecies.configurable
    || !initialThen || !currentThen || !('value' in initialThen) || !('value' in currentThen)
    || currentThen.value !== initialThen.value || currentThen.writable !== initialThen.writable
    || currentThen.enumerable !== initialThen.enumerable || currentThen.configurable !== initialThen.configurable) {
    throw new Error('activity_mcp_promise_unavailable');
  }
}
/** Only the module's own native async outputs, NOT arbitrary supplied thenables.
 * Invariant: intrinsic prototype constructor stays standard through begin/adopt;
 * producers do not replace global Promise/constructor or mutate returned raw.
 * Native await bypasses raw.then and Symbol.species. No after-effect validator
 * rejects a live producer without first owning its actual settlement.
 */
export function observeTrustedObserverPromise<T>(raw: Promise<T>, fulfilled: () => void, rejected: (reason: unknown) => void): void {
  void (async () => { try { await raw; fulfilled(); } catch (error) { rejected(error); } })();
}
