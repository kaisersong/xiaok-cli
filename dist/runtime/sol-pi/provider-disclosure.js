import { createHash } from 'node:crypto';
import { releaseCompoundPublicationHandoff } from './compound-publication-producer.js';
import { CompoundProviderAdmissionError, getProviderAncestorAdmissionBinding } from './compound-provider-admission.js';
import { createTransportAuthorizationError, isTransportAuthorizationError } from './transport-lease.js';
import { checkRequestCapacity } from './capacity-admission.js';
import { assertSynchronousFullSendResult } from './full-send-counter.js';
const states = new WeakMap();
function state(context) {
    const value = context && states.get(context);
    if (!value)
        throw createTransportAuthorizationError();
    return value;
}
function reject(value) {
    value.terminal ??= createTransportAuthorizationError();
    value.controller.abort(value.terminal);
    return value.terminal;
}
export function createProviderDisclosureContext(input) {
    const supplied = input.ancestorAdmission;
    let ancestor;
    if (supplied) {
        try {
            const { capability, destination, closureDigest } = supplied;
            const target = Object.freeze({ ...destination });
            if (target.url !== input.destination || target.model !== input.model || !target.provider || !/^[a-f0-9]{64}$/.test(closureDigest))
                throw createTransportAuthorizationError();
            ancestor = Object.freeze({ capability, destination: target, closureDigest, port: getProviderAncestorAdmissionBinding(capability) });
        }
        catch {
            throw createTransportAuthorizationError();
        }
    }
    const context = Object.freeze(Object.create(null));
    states.set(context, { ...input, ancestor, physicalIndex: 0, admissionPending: false, dependencies: Object.freeze(input.dependencies.map(dep => Object.freeze({ ...dep }))),
        fullSend: input.fullSend && Object.freeze({ counter: input.fullSend.counter, observationIds: Object.freeze([...input.fullSend.observationIds]) }),
        controller: new AbortController(), active: new Set() });
    return context;
}
export function getProviderDisclosureSignal(context) { return state(context).controller.signal; }
export function assertProviderDisclosureActive(context) {
    const value = state(context);
    if (value.terminal)
        throw value.terminal;
}
export function disposeProviderDisclosureContext(context) {
    const value = state(context);
    reject(value);
    // Actual fetch/cancel settlement releases leases; abort alone is not drain.
}
export function createProviderDisclosureFetch(context, rawFetch) {
    const value = state(context);
    if (value.fetch)
        return value.fetch;
    const guarded = async (input, supplied) => {
        assertProviderDisclosureActive(context);
        const init = { ...supplied };
        try {
            if (value.expectedSerializedBody !== undefined && (typeof value.expectedSerializedBody !== 'string' || init.body !== value.expectedSerializedBody))
                throw reject(value);
            if (typeof input !== 'string' || input !== value.destination || init.method !== 'POST' || typeof init.body !== 'string')
                throw reject(value);
            const parsed = JSON.parse(init.body);
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || parsed.model !== value.model)
                throw reject(value);
            checkRequestCapacity(value.capacityProfile, { destination: value.destination, model: value.model, serializedBody: init.body });
            if (value.ancestor && (value.admissionPending || value.physicalIndex >= 3))
                throw reject(value);
        }
        catch (error) {
            if (isTransportAuthorizationError(error) && error instanceof Error)
                value.terminal ??= error;
            throw reject(value);
        }
        const ancestor = value.ancestor;
        if (ancestor)
            value.admissionPending = true;
        const fullSendAttempt = value.fullSend && { logicalInvocationId: value.invocationId,
            serializedBody: init.body, observationIds: value.fullSend.observationIds };
        const callCounter = (operation) => {
            try {
                assertSynchronousFullSendResult(operation());
            }
            catch (cause) {
                if (!value.terminal) {
                    value.terminal = createTransportAuthorizationError();
                    value.terminal.message += ':FULL_SEND_COUNTER_REJECTED';
                    value.terminal.cause = cause;
                }
                throw reject(value);
            }
        };
        let receivedResponse, dispatchStarted = false;
        let transportSignal;
        let pendingHold;
        let attempt;
        let ticket;
        let facts;
        let consumed = false, reservationFailed = false, reservationUnconfirmed = false;
        let settlement;
        const onAbort = () => { if (isTransportAuthorizationError(transportSignal?.reason))
            reject(value); };
        const finish = (unknown = false) => settlement ??= (async () => {
            try {
                if (ticket)
                    await ancestor.port.settle(ticket, unknown ? 'unknown' : consumed ? 'drained' : 'cancelled_before_send');
                // Unknown reservation/durable facts never masquerade as successful drain.
                if (ancestor && (unknown || reservationUnconfirmed)) {
                    reject(value);
                    return;
                }
                transportSignal?.removeEventListener('abort', onAbort);
                attempt?.finish();
                pendingHold?.finish();
                value.active.delete(release);
                value.admissionPending = false;
            }
            catch (cause) {
                value.terminal ??= createTransportAuthorizationError();
                value.terminal.cause = cause;
                throw reject(value);
            }
        })();
        const release = () => { void finish().catch(() => { }); };
        try {
            value.capability ??= value.issuer.issue({ invocationId: value.invocationId, destination: value.destination,
                serializedBody: init.body, dependencies: value.dependencies });
            if (fullSendAttempt)
                callCounter(() => value.fullSend.counter.prepare(fullSendAttempt));
            if (ancestor) {
                pendingHold = value.issuer.holdAdmission(value.capability, value.invocationId);
                const signal = AbortSignal.any([pendingHold.signal, value.controller.signal, ...(init.signal ? [init.signal] : [])]);
                facts = Object.freeze({ logicalInvocationId: value.invocationId, attemptIndex: value.physicalIndex++,
                    serializedBodySha256: createHash('sha256').update(init.body).digest('hex'), destination: ancestor.destination, closureDigest: ancestor.closureDigest });
                try {
                    ticket = await ancestor.port.reserve({ ...facts, signal });
                }
                catch (error) {
                    reservationFailed = true;
                    reservationUnconfirmed = !(error instanceof CompoundProviderAdmissionError && error.undeliveredState !== 'unconfirmed');
                    throw error;
                }
            }
            attempt = value.issuer.dispatch(value.capability, { invocationId: value.invocationId, input: input,
                init: { ...init, signal: AbortSignal.any([value.controller.signal, ...(init.signal ? [init.signal] : []), ...(pendingHold ? [pendingHold.signal] : [])]) } }, (url, actualInit) => {
                transportSignal = actualInit.signal;
                transportSignal.addEventListener('abort', onAbort, { once: true });
                if (ticket) {
                    ancestor.port.consume(ticket, facts);
                    consumed = true;
                    releaseCompoundPublicationHandoff(ancestor.capability, ticket, facts);
                }
                dispatchStarted = true;
                return rawFetch(url, actualInit);
            });
            value.active.add(release);
            const response = receivedResponse = await attempt.response;
            transportSignal?.throwIfAborted();
            if (fullSendAttempt) {
                if (response.ok)
                    callCounter(() => value.fullSend.counter.confirm(fullSendAttempt));
                else
                    callCounter(() => value.fullSend.counter.markUnknown(fullSendAttempt));
            }
            if (!response.body) {
                await finish();
                return response;
            }
            const reader = response.body.getReader();
            let onBodyAbort;
            let cancellation;
            const complete = async () => {
                if (onBodyAbort)
                    transportSignal?.removeEventListener('abort', onBodyAbort);
                if (cancellation) {
                    try {
                        await cancellation;
                    }
                    catch {
                        await finish(Boolean(ancestor));
                        return;
                    }
                }
                await finish();
            };
            const body = new ReadableStream({
                start(controller) {
                    onBodyAbort = () => { controller.error(transportSignal?.reason); cancellation = reader.cancel(transportSignal?.reason); void complete().catch(() => { }); };
                    transportSignal?.addEventListener('abort', onBodyAbort, { once: true });
                    if (transportSignal?.aborted)
                        onBodyAbort();
                },
                async pull(controller) {
                    try {
                        const chunk = await reader.read();
                        if (chunk.done) {
                            await complete();
                            controller.close();
                        }
                        else
                            controller.enqueue(chunk.value);
                    }
                    catch (error) {
                        controller.error(error);
                        cancellation ??= reader.cancel(error);
                        await complete();
                    }
                },
                async cancel(reason) { cancellation = reader.cancel(reason); try {
                    await cancellation;
                }
                finally {
                    await complete();
                } },
            });
            return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
        }
        catch (error) {
            if (dispatchStarted && fullSendAttempt) {
                try {
                    callCounter(() => value.fullSend.counter.markUnknown(fullSendAttempt));
                }
                catch { /* Original failure and sticky counter uncertainty remain. */ }
            }
            let cancellationUncertain = false;
            if (receivedResponse?.body) {
                if (receivedResponse.body.locked)
                    cancellationUncertain = true;
                else {
                    try {
                        await receivedResponse.body.cancel(error);
                    }
                    catch {
                        cancellationUncertain = true;
                    }
                }
            }
            await finish(Boolean(ancestor) && cancellationUncertain);
            transportSignal?.removeEventListener('abort', onAbort);
            if (reservationFailed || ancestor && !dispatchStarted || isTransportAuthorizationError(error))
                throw reject(value);
            assertProviderDisclosureActive(context);
            throw error;
        }
    };
    value.fetch = guarded;
    return guarded;
}
