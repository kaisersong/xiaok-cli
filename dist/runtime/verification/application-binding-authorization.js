import { encodeApplicationBindingReviewStream } from './application-review-stream.js';
import { createHash } from 'node:crypto';
import { parseApplicationBindingReview, applicationBindingReviewBytes } from './application-binding-review.js';
/** Root-broker native boundary. The returned fact never enters a public issuer. */
export async function authorizeApplicationBinding(raw, options) {
    const { requestSource, authorityId, signal } = options, allowed = new Set(options.allowedUserIds), clock = options.clock.bind(options), resolveAccount = options.resolveAccount.bind(options), approve = options.approve.bind(options);
    if (requestSource !== 'user')
        throw Error('application_authorization_source');
    const review = parseApplicationBindingReview(raw);
    if (review.authorityId !== authorityId || !allowed.has(review.principal.uid))
        throw Error('application_authorization_authority');
    const bytes = applicationBindingReviewBytes(review), reviewHash = createHash('sha256').update(bytes).digest('hex');
    function deadline() { signal.throwIfAborted(); const c = clock(), d = review.deadline; if (!c || c.domainId !== d.domainId || c.qualificationEpoch !== d.qualificationEpoch || !Number.isSafeInteger(c.lowerBound) || !Number.isSafeInteger(c.upperBound) || c.lowerBound < d.notBefore || c.upperBound < c.lowerBound || c.upperBound >= d.validUntil)
        throw Error('application_authorization_deadline'); }
    async function current() { deadline(); const account = await resolveAccount(review.principal.uid, signal); deadline(); if (account !== review.principal.accountGeneration)
        throw Error('application_authorization_account'); }
    await current();
    const result = await approve({ uid: review.principal.uid, auditSessionId: review.principal.auditSessionId, reviewBytes: encodeApplicationBindingReviewStream(review), continuousDeadlineMs: review.deadline.validUntil }, signal);
    await current();
    if (result !== reviewHash)
        throw Error('application_authorization_unknown');
    return Object.freeze({ uid: review.principal.uid, auditSessionId: review.principal.auditSessionId, reviewHash });
}
