import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { computeSessionHistoryDigest } from '../../ai/runtime/session-store/store.js';
import { getCompoundPublicationOwnerBinding } from './compound-managed-lifecycle.js';
import { getObservationSessionOwnerHostBinding } from './observation-session-owner.js';
import { createProducerWindowQueue } from './producer-window-queue.js';
import { inspectConsumedCompoundProviderAttempt } from './compound-provider-admission.js';
const queues = new WeakMap(), currentProducer = new AsyncLocalStorage();
const finalPublications = new WeakMap();
const activeProducers = new WeakMap();
const windowOrigins = new WeakMap();
function track(producer) { let set = activeProducers.get(producer.binding.tree); if (!set)
    activeProducers.set(producer.binding.tree, set = new Set()); set.add(producer); }
function closeProducer(producer) { producer.open = false; activeProducers.get(producer.binding.tree)?.delete(producer); }
/** Only an original still-open producer captured before admission closed can
 * carry this origin. The lifecycle separately validates the actual metadata row. */
export function getCompoundPublicationWindowOrigin(tree) {
    const producer = currentProducer.getStore(), window = windowOrigins.get(tree);
    return producer?.open && producer.binding.tree === tree && window?.active && window.producers.has(producer) ? window.origin : undefined;
}
const handoffs = new WeakMap();
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); void promise.catch(() => { }); return { promise, resolve, reject }; }
const consumers = new WeakMap();
/** Fixed main/runtime factory port. Neither registrar nor inspector is exposed
 * on tools, session snapshots or transport options. A previous turn must finish
 * its original receipt before this actual owner can bind a new consumer. */
export function bindCompoundFinalPublicationConsumer(owner, turnId, consumer) {
    const entry = actual(owner);
    if (!entry)
        throw Error('compound_producer_owner_required');
    const previous = consumers.get(owner);
    if (!turnId || previous && !previous.settled)
        throw Error('compound_final_consumer_already_bound');
    const register = Object.getOwnPropertyDescriptor(consumer, 'register')?.value, inspectReceipt = Object.getOwnPropertyDescriptor(consumer, 'inspectReceipt')?.value;
    if (typeof register !== 'function' || typeof inspectReceipt !== 'function' || inspectReceipt.constructor?.name === 'AsyncFunction')
        throw Error('compound_final_consumer_invalid');
    consumers.set(owner, { turnId, consumer: Object.freeze({ register, inspectReceipt }), used: false, settled: false, completion: deferred() });
}
/** Actual root factory admission: wait only for this owner's previous Host tail.
 * Cancelling a new waiter never completes or replaces the original producer. */
export async function waitForCompoundFinalPublication(owner, signal) {
    const entry = actual(owner);
    if (!entry)
        return;
    const previous = consumers.get(owner);
    if (!previous || previous.settled)
        return;
    signal?.throwIfAborted();
    await new Promise((resolve, reject) => {
        const abort = () => { cleanup(); reject(signal?.reason ?? Error('compound_final_wait_cancelled')); };
        const cleanup = () => signal?.removeEventListener('abort', abort);
        previous.completion.promise.then(() => { cleanup(); resolve(); }, error => { cleanup(); reject(error); });
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted)
            abort();
    });
    signal?.throwIfAborted();
    entry.binding.assertCurrent();
    if (consumers.get(owner) !== previous || !previous.settled)
        throw Error('compound_final_consumer_changed');
}
export function hasCompoundFinalPublicationConsumer(owner, turnId) {
    const consumer = consumers.get(owner);
    return !!consumer && consumer.turnId === turnId && !consumer.used;
}
function actual(owner) {
    const host = getObservationSessionOwnerHostBinding(owner), binding = getCompoundPublicationOwnerBinding(owner);
    if (!binding)
        return undefined;
    binding.assertCurrent();
    if (binding.session !== host.session)
        throw Error('compound_producer_owner_mismatch');
    let queue = queues.get(binding.tree);
    if (!queue)
        queues.set(binding.tree, queue = createProducerWindowQueue());
    return { binding, queue, host };
}
/** Main/runtime-only iteration boundary. The lifetime ends after its actual
 * transport has drained; it does not close the long-lived owner's issuer. */
export async function runCompoundPublicationIteration(owner, turnId, work, signal) {
    const entry = actual(owner);
    if (!entry)
        return work();
    if (!turnId)
        throw Error('compound_producer_turn_required');
    const handoff = handoffs.get(owner);
    if (handoff?.turnId === turnId && handoff.producer) {
        if (handoff.iterationStarted)
            throw Error('compound_handoff_iteration_replayed');
        handoff.iterationStarted = true;
        const producer = handoff.producer;
        return currentProducer.run(producer, async () => {
            try {
                entry.binding.assertCurrent();
                const result = await work();
                await entry.host.waitForCurrentTransport();
                if (!handoff.released)
                    throw Error('compound_handoff_not_dispatched');
                return result;
            }
            catch (error) {
                handoff.window.fail(error);
                handoff.finished.reject(error);
                throw error;
            }
            finally {
                closeProducer(producer);
                handoff.finished.resolve();
                if (handoffs.get(owner) === handoff)
                    handoffs.delete(owner);
            }
        });
    }
    return entry.queue.run(scope => {
        const producer = { owner, binding: entry.binding, queue: entry.queue, scope, turnId, producerId: randomUUID(), kind: 'iteration', open: true };
        track(producer);
        return currentProducer.run(producer, async () => {
            let settledBodyResult;
            let settledBodyFailure;
            try {
                try {
                    entry.binding.assertCurrent();
                    {
                        settledBodyResult = await work();
                    }
                }
                catch (error) {
                    entry.queue.fail(error);
                    throw error;
                }
            }
            catch (error) {
                settledBodyFailure = { error };
            }
            {
                try {
                    await entry.host.waitForCurrentTransport();
                }
                catch (error) {
                    entry.queue.fail(error);
                    throw error;
                }
                finally {
                    closeProducer(producer);
                }
            }
            if (settledBodyFailure)
                throw settledBodyFailure.error;
            return settledBodyResult;
        });
    }, signal);
}
/** Main owns this one bounded window before freezing the new turn input. It
 * grants scheduling admission only; actual turn preparation/activation remains
 * governed by the original Main and ancestor-journal capabilities. */
export function openCompoundFollowupPublicationWindow(owner, signal, deadline, origin) {
    const entry = actual(owner);
    if (!entry || handoffs.has(owner))
        throw Error('compound_handoff_owner');
    const window = entry.queue.closeAdmission(), handoff = { owner, entry, window, iterationStarted: false, released: false, finished: deferred(), input: deferred(), signal };
    handoffs.set(owner, handoff);
    const captured = origin ? { producers: new Set(activeProducers.get(entry.binding.tree) ?? []), origin: Object.freeze({ session: origin.session, nativeInvocationId: origin.nativeInvocationId }), active: true } : undefined;
    if (captured)
        windowOrigins.set(entry.binding.tree, captured);
    const clearOrigin = () => { if (captured)
        captured.active = false; };
    const interrupted = deferred();
    const fail = (error) => { clearOrigin(); window.fail(error); handoff.finished.reject(error); handoff.input.reject(error); };
    const interrupt = (error) => { if (handoff.turnId)
        fail(error);
    else
        interrupted.reject(error); };
    const abort = () => interrupt(signal.reason ?? Error('compound_handoff_cancelled'));
    signal.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => interrupt(Error('compound_publication_window_timeout')), Math.max(1, Math.min(30000, deadline - Date.now())));
    timer.unref?.();
    const cleanup = () => { clearOrigin(); clearTimeout(timer); signal.removeEventListener('abort', abort); };
    void handoff.finished.promise.then(cleanup, cleanup);
    if (signal.aborted)
        abort();
    return Object.freeze({ drained: Promise.race([window.drained, interrupted.promise]),
        prepareTurn(turnId) { entry.binding.assertCurrent(); signal.throwIfAborted(); if (handoff.turnId || !turnId)
            throw Error('compound_handoff_turn'); handoff.turnId = turnId; },
        fail,
        cancelBeforeActivation(error) { if (handoff.turnId || handoff.producer)
            throw Error('compound_handoff_already_activated'); clearOrigin(); window.cancel(error); handoff.finished.resolve(); if (handoffs.get(owner) === handoff)
            handoffs.delete(owner); },
    });
}
/** Runs actual new input installation inside the first iteration's retained
 * slot. It returns after input installation while the slot awaits that exact
 * iteration, rather than holding a slot for the whole long-lived turn. */
export async function runCompoundTurnInput(owner, turnId, work) {
    const handoff = handoffs.get(owner);
    if (!handoff)
        return work();
    if (handoff.turnId !== turnId || handoff.producer)
        throw Error('compound_handoff_turn');
    const running = handoff.window.handoff(async (scope) => {
        const producer = { owner, binding: handoff.entry.binding, queue: handoff.entry.queue, scope, turnId, producerId: randomUUID(), kind: 'iteration', open: true };
        handoff.producer = producer;
        track(producer);
        await currentProducer.run(producer, async () => { handoff.signal?.throwIfAborted(); handoff.entry.binding.assertCurrent(); await work(); });
        handoff.input.resolve();
        await handoff.finished.promise;
    });
    void running.catch(error => { handoff.window.fail(error); handoff.input.reject(error); handoff.finished.reject(error); });
    await handoff.input.promise;
}
/** Called at the actual provider's final dispatch boundary, after its original
 * opaque attempt was consumed with the exact body/destination/closure tuple. */
export function releaseCompoundPublicationHandoff(cap, ticket, facts) {
    const producer = currentProducer.getStore();
    if (!producer)
        return;
    const handoff = handoffs.get(producer.owner);
    if (!handoff)
        return;
    if (handoff.released)
        return;
    if (handoff.producer !== producer || !producer.open || !handoff.iterationStarted || handoff.released || producer.binding.providerAdmission !== cap)
        throw Error('compound_handoff_dispatch');
    if (inspectConsumedCompoundProviderAttempt(cap, ticket, facts) === 'semantic')
        return;
    producer.binding.assertCurrent();
    handoff.signal?.throwIfAborted();
    handoff.released = true;
    const origin = windowOrigins.get(producer.binding.tree);
    if (origin)
        origin.active = false;
    handoff.window.release();
}
/** Metadata publication produced by an already admitted iteration remains in
 * that producer, including a same-tree recipient. Independent Main publication
 * takes its own slot before changing the recipient's session or serial queue. */
export function runCompoundObservationPublication(owner, work) {
    const entry = actual(owner);
    if (!entry)
        return work();
    const prior = currentProducer.getStore();
    const publish = async () => { entry.binding.assertCurrent(); const value = await work(); entry.binding.assertCurrent(); return value; };
    if (prior?.open && prior.binding.tree === entry.binding.tree)
        return prior.queue.inherit(prior.scope, publish);
    return entry.queue.run(scope => {
        const producer = { owner, binding: entry.binding, queue: entry.queue, scope, turnId: 'publication', producerId: randomUUID(), kind: 'publication', open: true };
        track(producer);
        return currentProducer.run(producer, async () => { try {
            return await publish();
        }
        catch (error) {
            entry.queue.fail(error);
            throw error;
        }
        finally {
            closeProducer(producer);
        } });
    });
}
/** The window is keyed by the coordinator's actual tree object, never a caller
 * supplied path or session id. The caller must seal under the original leases
 * after drained resolves; this object grants no execution authority. */
export function closeCompoundPublicationWindow(owner) {
    const entry = actual(owner);
    if (!entry)
        throw Error('compound_producer_owner_required');
    return entry.queue.closeAdmission();
}
/** Called by the actual final iteration after its complete history publisher.
 * It transfers scheduling ownership, so runner return need not await Main's
 * own result/snapshot tail. No JSON copy can finish this retained producer. */
export async function prepareCompoundFinalPublication(owner, turnId) {
    const producer = currentProducer.getStore(), entry = actual(owner);
    if (!entry || !producer?.open || producer.kind !== 'iteration' || producer.owner !== owner || producer.binding !== entry.binding || producer.turnId !== turnId || producer.ticket)
        throw Error('compound_final_publication_scope');
    await entry.host.waitForCurrentTransport();
    entry.binding.assertCurrent();
    if (!producer.open)
        throw Error('compound_final_publication_scope');
    const snapshot = entry.binding.session.exportSnapshot(), historyDigest = computeSessionHistoryDigest(snapshot);
    if (entry.binding.session.getPublishedHistoryBasis() !== historyDigest)
        throw Error('compound_final_history_unpublished');
    const ticket = Object.freeze({});
    const rootSessionId = entry.binding.tree.sessionIdentity;
    const facts = Object.freeze({ session: entry.binding.session, sessionId: snapshot.sessionId, rootSessionId, role: snapshot.sessionId === rootSessionId ? 'root' : 'child', turnId, producerId: producer.producerId, historyDigest });
    finalPublications.set(ticket, { facts, producer, continuation: entry.queue.transfer(producer.scope) });
    producer.ticket = ticket;
    return ticket;
}
export function getCompoundFinalPublicationBinding(ticket) {
    const entry = ticket && typeof ticket === 'object' ? finalPublications.get(ticket) : undefined;
    if (!entry)
        throw Error('compound_final_publication_ticket');
    return entry.facts;
}
/** Only the factory-captured consumer receives this ticket's one completion
 * closure. There is intentionally no exported finish(ticket) operation. */
export async function publishCompoundFinalPublication(owner, turnId) {
    const consumer = consumers.get(owner);
    if (!consumer || consumer.turnId !== turnId || consumer.used)
        throw Error('compound_final_consumer_missing');
    consumer.used = true;
    const ticket = await prepareCompoundFinalPublication(owner, turnId).catch(error => { consumer.completion.reject(error); throw error; }), entry = finalPublications.get(ticket);
    let notified = false;
    try {
        await consumer.consumer.register(ticket, async (receipt) => {
            if (notified || consumers.get(owner) !== consumer)
                throw Error('compound_final_publication_already_consumed');
            const facts = consumer.consumer.inspectReceipt(receipt), expected = entry.facts;
            if (!facts || facts.ticket !== ticket || facts.sessionId !== expected.sessionId || facts.turnId !== expected.turnId || facts.historyDigest !== expected.historyDigest || !Number.isSafeInteger(facts.snapshotRevision) || facts.snapshotRevision < 0)
                throw Error('compound_final_publication_receipt');
            entry.continuation.complete();
            notified = true;
            consumer.settled = true;
            consumer.completion.resolve();
        });
    }
    catch (error) {
        entry.continuation.fail(error);
        consumer.completion.reject(error);
        throw error;
    }
}
/** Continues only the transferred tail. It does not reopen the old iteration
 * for new tools or provider dispatch, and does not itself finish the producer. */
export function runCompoundFinalPublication(ticket, work) {
    const entry = ticket && typeof ticket === 'object' ? finalPublications.get(ticket) : undefined;
    if (!entry)
        return Promise.reject(Error('compound_final_publication_ticket'));
    return entry.continuation.run(work);
}
