import { AsyncResource } from 'node:async_hooks';
const LIMIT = 512;
export function createProducerWindowQueue() {
    const scopes = new WeakMap(), active = new Set(), waiting = new Set();
    let slots = 0, failure;
    let current;
    const maybeDrained = () => { if (current && !current.settled && !active.size) {
        current.settled = true;
        current.phase = 'held';
        current.resolve();
    } };
    const setFailure = (error) => { failure ??= { error }; const window = current; current = undefined; if (window && !window.settled) {
        window.settled = true;
        window.reject(failure.error);
    } for (const entry of [...waiting])
        entry.reject(failure.error); };
    const finishScope = (scope) => { if (scope.finished)
        return; scope.finished = true; scopes.delete(scope.token); active.delete(scope); slots--; maybeDrained(); };
    const reserve = () => { if (slots >= (current ? LIMIT - 1 : LIMIT))
        throw Error('producer_window_capacity'); slots++; };
    const execute = async (work) => {
        const token = Object.freeze({}), scope = { token, open: true, bodyDone: false, detached: false, releaseRequested: false, finished: false, children: new Set() };
        scopes.set(token, scope);
        active.add(scope);
        try {
            let value, problem;
            try {
                value = await work(token);
            }
            catch (error) {
                problem = { error };
            }
            finally {
                scope.open = false;
            }
            while (scope.children.size)
                await Promise.allSettled([...scope.children]);
            if (problem || scope.childFailure) {
                const error = (problem ?? scope.childFailure).error;
                if (scope.detached)
                    setFailure(error);
                throw error;
            }
            return value;
        }
        finally {
            scope.bodyDone = true;
            if (!scope.detached || scope.releaseRequested)
                finishScope(scope);
        }
    };
    const run = (work, signal) => {
        work = AsyncResource.bind(work);
        try {
            if (failure)
                throw failure.error;
            signal?.throwIfAborted();
            reserve();
        }
        catch (error) {
            return Promise.reject(error);
        }
        if (!current)
            return execute(work);
        return new Promise((resolve, reject) => {
            let consumed = false;
            const remove = () => { waiting.delete(entry); signal?.removeEventListener('abort', entry.abort); };
            const entry = { signal, start() { if (consumed)
                    return; consumed = true; remove(); void execute(work).then(resolve, reject); },
                reject(error) { if (consumed)
                    return; consumed = true; remove(); slots--; reject(error); }, abort() { entry.reject(signal?.reason ?? Error('producer_window_aborted')); } };
            waiting.add(entry);
            signal?.addEventListener('abort', entry.abort, { once: true });
            if (signal?.aborted)
                entry.abort();
        });
    };
    return Object.freeze({ run, fail: setFailure,
        /** Transfer scheduling ownership to an authenticated publication adapter.
         * This primitive's completion method itself is not a physical receipt. */
        transfer(token) {
            const scope = token && typeof token === 'object' ? scopes.get(token) : undefined;
            if (!scope?.open || scope.detached)
                throw Error('producer_scope_not_current');
            scope.detached = true;
            let consumed = false, running = false;
            return Object.freeze({
                async run(work) {
                    if (consumed)
                        throw Error('producer_publication_already_consumed');
                    if (running)
                        throw Error('producer_publication_running');
                    if (failure)
                        throw failure.error;
                    running = true;
                    try {
                        return await work();
                    }
                    catch (error) {
                        consumed = true;
                        setFailure(error);
                        throw error;
                    }
                    finally {
                        running = false;
                    }
                },
                complete() { if (consumed)
                    throw Error('producer_publication_already_consumed'); if (running)
                    throw Error('producer_publication_running'); consumed = true; scope.releaseRequested = true; if (scope.bodyDone)
                    finishScope(scope); },
                fail(error) { if (consumed)
                    throw Error('producer_publication_already_consumed'); consumed = true; setFailure(error); },
            });
        },
        inherit(token, work) {
            const parent = token && typeof token === 'object' ? scopes.get(token) : undefined;
            try {
                if (!parent?.open)
                    throw Error('producer_scope_not_current');
                if (failure)
                    throw failure.error;
                if (slots >= LIMIT)
                    throw Error('producer_window_capacity');
                slots++;
            }
            catch (error) {
                return Promise.reject(error);
            }
            const child = execute(work);
            parent.children.add(child);
            void child.then(() => parent.children.delete(child), error => { parent.childFailure ??= { error }; parent.children.delete(child); });
            return child;
        },
        closeAdmission() {
            if (failure)
                throw failure.error;
            if (current)
                throw Error('producer_window_already_open');
            let resolve, reject;
            const drained = new Promise((yes, no) => { resolve = yes; reject = no; });
            // The owner may cancel before it awaits drain. Keep that legitimate ordering
            // from producing an unhandled rejection; callers still receive the rejection.
            void drained.catch(() => { });
            const window = { phase: 'closing', resolve, reject, settled: false };
            current = window;
            maybeDrained();
            return Object.freeze({ drained,
                handoff(work) {
                    if (failure)
                        return Promise.reject(failure.error);
                    if (current !== window || window.phase !== 'held')
                        return Promise.reject(Error('producer_window_handoff_not_current'));
                    window.phase = 'handoff';
                    slots++;
                    return execute(work);
                },
                release() { if (current !== window || window.phase === 'closing')
                    throw Error('producer_window_not_drained'); current = undefined; for (const entry of [...waiting])
                    queueMicrotask(() => entry.start()); },
                cancel(error) { if (current !== window || window.phase === 'handoff')
                    throw Error('producer_window_cannot_cancel'); current = undefined; if (!window.settled) {
                    window.settled = true;
                    window.reject(error);
                } for (const entry of [...waiting])
                    queueMicrotask(() => entry.start()); },
                fail(error) { if (current !== window)
                    return; setFailure(error); },
            });
        },
    });
}
