import { canonicalVerificationJson } from './protocol.js';
import { COMPLETION_METHODS } from './completion-transport.js';
/** Private installed routing. Renewing eligibility is not renewing native scope,
 * proof expiry or a material handle; actual handlers still validate all of them. */
export function createControllerOperationRouting(input) {
    const publicationObserveIntentCompletion = input.publication.observeIntentCompletion?.bind(input.publication);
    const publicationObserveIntentDependencies = input.publication.observeIntentDependencies?.bind(input.publication);
    const publicationObserveLoopSet = input.publication.observeLoopSet?.bind(input.publication);
    const verificationRecoverRequest = input.verification.recoverRequest?.bind(input.verification);
    const verificationPrepareRequest = input.verification.prepareRequest?.bind(input.verification), verificationLookupRequest = input.verification.lookupRequest?.bind(input.verification), verificationRetireRequest = input.verification.retireRequest?.bind(input.verification);
    const inspectObligation = input.verification.inspectObligation?.bind(input.verification);
    const recoverRequest = input.publication.recoverRequest?.bind(input.publication);
    const requestPrepare = input.publication.prepareRequest?.bind(input.publication), requestLookup = input.publication.lookupRequest?.bind(input.publication), requestRecover = input.publication.recoverUnapproved?.bind(input.publication);
    const publicationReadOwnerPayload = input.publication.readOwnerPayload.bind(input.publication), publicationObserveOwner = input.publication.observeOwner.bind(input.publication), publicationRecoverExpired = input.publication.recoverExpired.bind(input.publication), publicationPrepare = input.publication.prepare.bind(input.publication), publicationApprove = input.publication.approve.bind(input.publication), publicationReconcile = input.publication.reconcile.bind(input.publication);
    const current = input.assertCurrent.bind(input), renew = input.renew.bind(input), prepare = input.verification.prepare.bind(input.verification), dispatch = input.verification.dispatch.bind(input.verification), completion = input.completion.invoke.bind(input.completion), execution = input.execution.invoke.bind(input.execution);
    return Object.freeze({ async invoke(method, payload, peer, signal) {
            // Capture the original authenticated request before lifecycle callbacks or I/O.
            payload = JSON.parse(canonicalVerificationJson(payload));
            peer = structuredClone(peer);
            current();
            signal.throwIfAborted();
            if (method === 'verification.recoverRequest') {
                if (!verificationRecoverRequest)
                    throw Error('controller_verification_method');
                return verificationRecoverRequest(payload, peer, signal);
            }
            if (method === 'verification.lookupRequest' || method === 'verification.retireRequest') {
                const handler = method === 'verification.lookupRequest' ? verificationLookupRequest : verificationRetireRequest;
                if (!handler)
                    throw Error('controller_verification_method');
                return handler(payload, peer);
            }
            if (method === 'verification.prepareRequest') {
                if (!verificationPrepareRequest)
                    throw Error('controller_verification_method');
                await renew(signal);
                current();
                signal.throwIfAborted();
                return verificationPrepareRequest(payload, peer, signal);
            }
            if (method === 'verification.inspectObligation') {
                if (!inspectObligation)
                    throw Error('controller_verification_method');
                return inspectObligation(payload, peer);
            }
            if (method === 'publication.recoverRequest') {
                if (!recoverRequest)
                    throw Error('controller_publication_method');
                return recoverRequest(payload, peer);
            }
            if (method === 'publication.lookupRequest' || method === 'publication.recoverUnapproved') {
                const handler = method === 'publication.lookupRequest' ? requestLookup : requestRecover;
                if (!handler)
                    throw Error('controller_publication_method');
                return handler(payload, peer);
            }
            if (method === 'publication.prepareRequest') {
                if (!requestPrepare)
                    throw Error('controller_publication_method');
                await renew(signal);
                current();
                signal.throwIfAborted();
                return requestPrepare(payload, peer);
            }
            if (method === 'publication.observeIntentCompletion') {
                if (!publicationObserveIntentCompletion)
                    throw Error('controller_publication_method');
                await renew(signal);
                current();
                signal.throwIfAborted();
                return publicationObserveIntentCompletion(payload, peer, signal);
            }
            if (method === 'publication.observeIntentDependencies') {
                if (!publicationObserveIntentDependencies)
                    throw Error('controller_publication_method');
                await renew(signal);
                current();
                signal.throwIfAborted();
                return publicationObserveIntentDependencies(payload, peer, signal);
            }
            if (method === 'publication.observeLoopSet') {
                if (!publicationObserveLoopSet)
                    throw Error('controller_publication_method');
                await renew(signal);
                current();
                signal.throwIfAborted();
                return publicationObserveLoopSet(payload, peer, signal);
            }
            if (method === 'publication.prepare' || method === 'publication.approve' || method === 'publication.reconcile' || method === 'publication.recoverExpired' || method === 'publication.observeOwner' || method === 'publication.readOwnerPayload') {
                await renew(signal);
                current();
                signal.throwIfAborted();
                if (method === 'publication.prepare')
                    return publicationPrepare(payload, peer);
                if (method === 'publication.approve')
                    return publicationApprove(payload, peer, signal);
                if (method === 'publication.readOwnerPayload')
                    return publicationReadOwnerPayload(payload, peer, signal);
                if (method === 'publication.observeOwner')
                    return publicationObserveOwner(payload, peer, signal);
                if (method === 'publication.recoverExpired')
                    return publicationRecoverExpired(payload, peer, signal);
                return publicationReconcile(payload, peer, signal);
            }
            if (method === 'verification.prepare' || method === 'verification.dispatch' || COMPLETION_METHODS.includes(method)) {
                await renew(signal);
                current();
                signal.throwIfAborted();
                if (method === 'verification.prepare')
                    return prepare(payload, peer, signal);
                if (method === 'verification.dispatch')
                    return dispatch(payload, peer, signal);
                return completion(method, payload, peer, signal);
            }
            return execution(method, payload, peer, signal);
        } });
}
