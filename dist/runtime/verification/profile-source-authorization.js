import { createHash } from 'node:crypto';
import { parseProfileSourceReview, profileSourceReviewBytes } from './profile-source-review.js';
/** Private root-broker boundary. This native approval fact does not itself prove
 * source completeness, all-kind custody, import or a metadata capacity mapping. */
export async function authorizeProfileSources(raw, options) {
    const { requestSource, authorityId, signal } = options, allowed = new Set(options.allowedUserIds), clock = options.clock.bind(options), resolveAccount = options.resolveAccount.bind(options), approve = options.approve.bind(options);
    if (requestSource !== 'user')
        throw Error('profile_source_authorization_source');
    const review = parseProfileSourceReview(raw);
    if (review.authorityId !== authorityId || !allowed.has(review.principal.uid))
        throw Error('profile_source_authorization_authority');
    const bytes = profileSourceReviewBytes(review), reviewHash = createHash('sha256').update(bytes).digest('hex');
    function deadline() { signal.throwIfAborted(); const c = clock(), d = review.deadline; if (!c || c.domainId !== d.domainId || c.qualificationEpoch !== d.qualificationEpoch || !Number.isSafeInteger(c.lowerBound) || !Number.isSafeInteger(c.upperBound) || c.lowerBound < d.notBefore || c.upperBound < c.lowerBound || c.upperBound >= d.validUntil)
        throw Error('profile_source_authorization_deadline'); }
    async function current() { deadline(); const account = await resolveAccount(review.principal.uid, signal); deadline(); if (account !== review.principal.accountGeneration)
        throw Error('profile_source_authorization_account'); }
    await current();
    const answer = await approve({ uid: review.principal.uid, auditSessionId: review.principal.auditSessionId, reviewBytes: Buffer.from(bytes), continuousDeadlineMs: review.deadline.validUntil }, signal);
    await current();
    if (answer !== reviewHash)
        throw Error('profile_source_authorization_unknown');
    return Object.freeze({ purpose: 'profile-source-custody', authorityId, challengeId: review.challengeId, uid: review.principal.uid, auditSessionId: review.principal.auditSessionId, inventoryHash: review.inventoryHash, reviewHash });
}
