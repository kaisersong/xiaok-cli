import { createHash, randomUUID } from 'node:crypto';

export interface TransportDependency {
  readonly authority: object;
  readonly key: string;
  readonly epoch: number;
}

/** Host-only port: all mutations and this admission must share its lock domain. */
export interface TransportAuthorityPort {
  readonly authority: object;
  withAdmission<T>(operation: () => T): T;
  validate(snapshot: readonly TransportDependency[], destination: string): void;
  onRevoke(listener: () => void): () => void;
}

export interface TransportCapability { readonly opaqueTransportCapability: never }
export interface TransportRequest {
  invocationId: string;
  input: string;
  init: RequestInit;
}
export interface TransportAttempt {
  attemptId: string;
  response: Promise<Response>;
  finish(): void;
}
type FetchPort = (input: string, init: RequestInit) => Promise<Response>;
interface Claims {
  invocationId: string;
  destination: string;
  digest: string;
  dependencies: readonly TransportDependency[];
  terminal: boolean;
  active: Set<AbortController>;
}

const authorizationErrors = new WeakSet<object>();
export function createTransportAuthorizationError(): Error {
  const error = new Error('SOL_PI_TRANSPORT_AUTHORIZATION_REJECTED');
  authorizationErrors.add(error);
  return error;
}
const denied = createTransportAuthorizationError;
export function isTransportAuthorizationError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && authorizationErrors.has(error);
}
function isThenable(value: unknown): boolean {
  return value !== null && (typeof value === 'object' || typeof value === 'function')
    && typeof (value as { then?: unknown }).then === 'function';
}
function suppressPromise(value: unknown): void {
  if (isThenable(value)) void Promise.resolve(value).catch(() => {});
}
function digest(body: string): string { return createHash('sha256').update(body, 'utf8').digest('hex'); }
function assertDestination(value: string): void {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.href !== value) throw denied();
}

export function createTransportLeaseIssuer(port: TransportAuthorityPort) {
  const capabilities = new WeakMap<object, Claims>();
  const references = new Set<WeakRef<Claims>>();
  const finalizer = new FinalizationRegistry<WeakRef<Claims>>(ref => references.delete(ref));
  let disposed = false;
  let unsettled = 0;
  const drainWaiters = new Set<() => void>();
  function dispose() {
    if (disposed) return;
    disposed = true;
    try { unsubscribe(); } finally {
      for (const ref of references) { const claims = ref.deref(); if (claims) invalidate(claims); }
      references.clear();
    }
  }

  function invalidate(claims: Claims) {
    claims.terminal = true;
    for (const controller of claims.active) controller.abort(denied());
  }
  function validate(claims: Claims) {
    if (disposed || claims.terminal) throw denied();
    try {
      const result: unknown = port.validate(claims.dependencies, claims.destination);
      if (result !== undefined) { suppressPromise(result); throw denied(); }
    } catch {
      invalidate(claims); throw denied();
    }
  }
  function admit<T>(operation: () => T): T {
    if (disposed || port.withAdmission.constructor.name === 'AsyncFunction') throw denied();
    let open = true;
    let count = 0;
    let value: T | undefined;
    try {
      const result = port.withAdmission(() => {
        // A delayed callback from an invalid async port must be inert.
        if (!open) return undefined as T;
        if (++count !== 1) throw denied();
        value = operation();
        return value;
      });
      if (isThenable(result)) { suppressPromise(result); throw denied(); }
      if (count !== 1 || result !== value) throw denied();
      return value as T;
    } finally { open = false; }
  }

  const unsubscribe = port.onRevoke(() => {
    for (const ref of references) {
      const claims = ref.deref();
      if (!claims) { references.delete(ref); continue; }
      try { admit(() => validate(claims)); } catch { invalidate(claims); }
    }
  });

  return {
    issue(input: { invocationId: string; destination: string; serializedBody: string; dependencies: readonly TransportDependency[] }): TransportCapability {
      try {
        return admit(() => {
          assertDestination(input.destination);
          if (!input.invocationId || typeof input.serializedBody !== 'string' || !input.serializedBody
            || !Array.isArray(input.dependencies) || !input.dependencies.length) throw denied();
          const dependencies = Object.freeze(input.dependencies.map(dep => {
            if (dep.authority !== port.authority || !dep.key || !Number.isSafeInteger(dep.epoch) || dep.epoch < 0) throw denied();
            return Object.freeze({ authority: dep.authority, key: dep.key, epoch: dep.epoch });
          }));
          const claims: Claims = { invocationId: input.invocationId, destination: input.destination,
            digest: digest(input.serializedBody), dependencies, terminal: false, active: new Set() };
          validate(claims);
          const cap = Object.freeze(Object.create(null)) as TransportCapability;
          capabilities.set(cap, claims);
          const ref = new WeakRef(claims); references.add(ref); finalizer.register(claims, ref);
          return cap;
        });
      } catch { throw denied(); }
    },
    /** Holds owner drain during an asynchronous durable reservation. This is
     * not a physical transport attempt and never calls fetch. */
    holdAdmission(capability: TransportCapability, invocationId: string) {
      const claims = capabilities.get(capability);
      if (!claims) throw denied();
      try {
        return admit(() => {
          validate(claims);
          if (claims.invocationId !== invocationId) throw denied();
          const controller = new AbortController();
          claims.active.add(controller); unsettled++;
          let finished = false;
          return Object.freeze({ signal: controller.signal, finish() {
            if (finished) return; finished = true;
            claims.active.delete(controller); unsettled--;
            if (!unsettled) { for (const done of drainWaiters) done(); drainWaiters.clear(); }
          } });
        });
      } catch { invalidate(claims); throw denied(); }
    },
    dispatch(capability: TransportCapability, request: TransportRequest, fetchImpl: FetchPort): TransportAttempt {
      const claims = capabilities.get(capability);
      if (!claims) throw denied();
      try {
        return admit(() => {
          validate(claims);
          const input = request.input;
          const init = { ...request.init };
          if (request.invocationId !== claims.invocationId || typeof input !== 'string'
            || input !== claims.destination || init.method !== 'POST'
            || typeof init.body !== 'string' || digest(init.body) !== claims.digest) throw denied();
          init.signal?.throwIfAborted();
          const controller = new AbortController();
          claims.active.add(controller);
          const signal = init.signal ? AbortSignal.any([init.signal, controller.signal]) : controller.signal;
          const attemptId = randomUUID();
          let response: Promise<Response>;
          let responseSettled = false, finished = false, counted = true;
          unsettled++;
          const settle = () => {
            if (!counted || !responseSettled || !finished) return;
            counted = false; unsettled--; claims.active.delete(controller);
            if (!unsettled) { for (const done of drainWaiters) done(); drainWaiters.clear(); }
          };
          try { response = Promise.resolve(fetchImpl(input, { ...init, redirect: 'error', signal })); }
          catch (error) { response = Promise.reject(error); }
          void response.then(() => { responseSettled = true; settle(); }, () => { responseSettled = true; settle(); });
          return { attemptId, response,
            finish() { finished = true; settle(); } };
        });
      } catch {
        invalidate(claims); throw denied();
      }
    },
    dispose,
    /** Passive local transport drain. Admission is not closed by this method;
     * the host iteration window must prevent a new producer from dispatching. */
    waitForDrain(): Promise<void> {
      return unsettled ? new Promise<void>(resolve => { drainWaiters.add(resolve); }) : Promise.resolve();
    },
    disposeAndDrain(): Promise<void> {
      dispose();
      return unsettled ? new Promise<void>(resolve => { drainWaiters.add(resolve); }) : Promise.resolve();
    },
  };
}
