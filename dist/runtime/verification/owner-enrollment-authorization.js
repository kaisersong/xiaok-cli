import { createHash } from 'node:crypto';
import { parseOwnerEnrollmentReview } from './owner-enrollment-review.js';
import { canonicalVerificationJson } from './protocol.js';
/** Private root-broker operation. Callbacks are installed native ports, never RPC
 * inputs. The returned native fact is not a public enrollment or mutation grant. */
export async function authorizeOwnerEnrollment(raw, options) {
    const { authorityId, signal, clock, resolveAccount, approve } = options, allowed = new Set(options.allowedUserIds), review = parseOwnerEnrollmentReview(raw);
    if (review.authorityId !== authorityId || !allowed.has(review.principal.uid))
        throw Error('enrollment_authority');
    const bytes = Buffer.from(canonicalVerificationJson(review).replace(/[\u007f-\uffff]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'))), reviewHash = createHash('sha256').update(bytes).digest('hex');
    function deadline() { signal.throwIfAborted(); const sample = clock(), d = review.deadline; if (!sample || sample.domainId !== d.domainId || sample.qualificationEpoch !== d.qualificationEpoch || !Number.isSafeInteger(sample.lowerBound) || !Number.isSafeInteger(sample.upperBound) || sample.lowerBound > d.validUntil || sample.upperBound < sample.lowerBound || sample.lowerBound < d.notBefore || sample.upperBound >= d.validUntil)
        throw Error('enrollment_deadline'); }
    async function current() { deadline(); const generation = await resolveAccount(review.principal.uid, signal); deadline(); if (generation !== review.principal.accountGeneration)
        throw Error('enrollment_account_changed'); }
    await current();
    const result = await approve({ uid: review.principal.uid, auditSessionId: review.principal.auditSessionId, reviewBytes: Buffer.from(bytes), continuousDeadlineMs: review.deadline.validUntil }, signal);
    await current();
    if (result !== reviewHash)
        throw Error('enrollment_approval_unknown');
    return Object.freeze({ uid: review.principal.uid, auditSessionId: review.principal.auditSessionId, reviewHash });
}
