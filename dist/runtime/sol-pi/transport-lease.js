import { createHash, randomUUID } from 'node:crypto';
const authorizationErrors = new WeakSet();
export function createTransportAuthorizationError() {
    const error = new Error('SOL_PI_TRANSPORT_AUTHORIZATION_REJECTED');
    authorizationErrors.add(error);
    return error;
}
const denied = createTransportAuthorizationError;
export function isTransportAuthorizationError(error) {
    return typeof error === 'object' && error !== null && authorizationErrors.has(error);
}
function isThenable(value) {
    return value !== null && (typeof value === 'object' || typeof value === 'function')
        && typeof value.then === 'function';
}
function suppressPromise(value) {
    if (isThenable(value))
        void Promise.resolve(value).catch(() => { });
}
function digest(body) { return createHash('sha256').update(body, 'utf8').digest('hex'); }
function assertDestination(value) {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.href !== value)
        throw denied();
}
export function createTransportLeaseIssuer(port) {
    const capabilities = new WeakMap();
    const references = new Set();
    const finalizer = new FinalizationRegistry(ref => references.delete(ref));
    let disposed = false;
    let unsettled = 0;
    const drainWaiters = new Set();
    function dispose() {
        if (disposed)
            return;
        disposed = true;
        try {
            unsubscribe();
        }
        finally {
            for (const ref of references) {
                const claims = ref.deref();
                if (claims)
                    invalidate(claims);
            }
            references.clear();
        }
    }
    function invalidate(claims) {
        claims.terminal = true;
        for (const controller of claims.active)
            controller.abort(denied());
    }
    function validate(claims) {
        if (disposed || claims.terminal)
            throw denied();
        try {
            const result = port.validate(claims.dependencies, claims.destination);
            if (result !== undefined) {
                suppressPromise(result);
                throw denied();
            }
        }
        catch {
            invalidate(claims);
            throw denied();
        }
    }
    function admit(operation) {
        if (disposed || port.withAdmission.constructor.name === 'AsyncFunction')
            throw denied();
        let open = true;
        let count = 0;
        let value;
        try {
            const result = port.withAdmission(() => {
                // A delayed callback from an invalid async port must be inert.
                if (!open)
                    return undefined;
                if (++count !== 1)
                    throw denied();
                value = operation();
                return value;
            });
            if (isThenable(result)) {
                suppressPromise(result);
                throw denied();
            }
            if (count !== 1 || result !== value)
                throw denied();
            return value;
        }
        finally {
            open = false;
        }
    }
    const unsubscribe = port.onRevoke(() => {
        for (const ref of references) {
            const claims = ref.deref();
            if (!claims) {
                references.delete(ref);
                continue;
            }
            try {
                admit(() => validate(claims));
            }
            catch {
                invalidate(claims);
            }
        }
    });
    return {
        issue(input) {
            try {
                return admit(() => {
                    assertDestination(input.destination);
                    if (!input.invocationId || typeof input.serializedBody !== 'string' || !input.serializedBody
                        || !Array.isArray(input.dependencies) || !input.dependencies.length)
                        throw denied();
                    const dependencies = Object.freeze(input.dependencies.map(dep => {
                        if (dep.authority !== port.authority || !dep.key || !Number.isSafeInteger(dep.epoch) || dep.epoch < 0)
                            throw denied();
                        return Object.freeze({ authority: dep.authority, key: dep.key, epoch: dep.epoch });
                    }));
                    const claims = { invocationId: input.invocationId, destination: input.destination,
                        digest: digest(input.serializedBody), dependencies, terminal: false, active: new Set() };
                    validate(claims);
                    const cap = Object.freeze(Object.create(null));
                    capabilities.set(cap, claims);
                    const ref = new WeakRef(claims);
                    references.add(ref);
                    finalizer.register(claims, ref);
                    return cap;
                });
            }
            catch {
                throw denied();
            }
        },
        /** Holds owner drain during an asynchronous durable reservation. This is
         * not a physical transport attempt and never calls fetch. */
        holdAdmission(capability, invocationId) {
            const claims = capabilities.get(capability);
            if (!claims)
                throw denied();
            try {
                return admit(() => {
                    validate(claims);
                    if (claims.invocationId !== invocationId)
                        throw denied();
                    const controller = new AbortController();
                    claims.active.add(controller);
                    unsettled++;
                    let finished = false;
                    return Object.freeze({ signal: controller.signal, finish() {
                            if (finished)
                                return;
                            finished = true;
                            claims.active.delete(controller);
                            unsettled--;
                            if (!unsettled) {
                                for (const done of drainWaiters)
                                    done();
                                drainWaiters.clear();
                            }
                        } });
                });
            }
            catch {
                invalidate(claims);
                throw denied();
            }
        },
        dispatch(capability, request, fetchImpl) {
            const claims = capabilities.get(capability);
            if (!claims)
                throw denied();
            try {
                return admit(() => {
                    validate(claims);
                    const input = request.input;
                    const init = { ...request.init };
                    if (request.invocationId !== claims.invocationId || typeof input !== 'string'
                        || input !== claims.destination || init.method !== 'POST'
                        || typeof init.body !== 'string' || digest(init.body) !== claims.digest)
                        throw denied();
                    init.signal?.throwIfAborted();
                    const controller = new AbortController();
                    claims.active.add(controller);
                    const signal = init.signal ? AbortSignal.any([init.signal, controller.signal]) : controller.signal;
                    const attemptId = randomUUID();
                    let response;
                    let responseSettled = false, finished = false, counted = true;
                    unsettled++;
                    const settle = () => {
                        if (!counted || !responseSettled || !finished)
                            return;
                        counted = false;
                        unsettled--;
                        claims.active.delete(controller);
                        if (!unsettled) {
                            for (const done of drainWaiters)
                                done();
                            drainWaiters.clear();
                        }
                    };
                    try {
                        response = Promise.resolve(fetchImpl(input, { ...init, redirect: 'error', signal }));
                    }
                    catch (error) {
                        response = Promise.reject(error);
                    }
                    void response.then(() => { responseSettled = true; settle(); }, () => { responseSettled = true; settle(); });
                    return { attemptId, response,
                        finish() { finished = true; settle(); } };
                });
            }
            catch {
                invalidate(claims);
                throw denied();
            }
        },
        dispose,
        /** Passive local transport drain. Admission is not closed by this method;
         * the host iteration window must prevent a new producer from dispatching. */
        waitForDrain() {
            return unsettled ? new Promise(resolve => { drainWaiters.add(resolve); }) : Promise.resolve();
        },
        disposeAndDrain() {
            dispose();
            return unsettled ? new Promise(resolve => { drainWaiters.add(resolve); }) : Promise.resolve();
        },
    };
}
