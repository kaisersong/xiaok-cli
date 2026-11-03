export declare const ObserverNativePromise: PromiseConstructor;
export declare function assertObserverPromiseAmbient(): void;
/** Only the module's own native async outputs, NOT arbitrary supplied thenables.
 * Invariant: intrinsic prototype constructor stays standard through begin/adopt;
 * producers do not replace global Promise/constructor or mutate returned raw.
 * Native await bypasses raw.then and Symbol.species. No after-effect validator
 * rejects a live producer without first owning its actual settlement.
 */
export declare function observeTrustedObserverPromise<T>(raw: Promise<T>, fulfilled: () => void, rejected: (reason: unknown) => void): void;
