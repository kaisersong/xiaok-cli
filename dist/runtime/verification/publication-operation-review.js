import { canonicalVerificationJson, parseVerificationTuple } from './protocol.js';
function shape(value, keys) { if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== keys.sort().join(','))
    throw Error('publication_review_shape'); }
function id(v) { if (typeof v !== 'string' || !v || Buffer.byteLength(v) > 160 || /[\x00-\x1f\x7f]/.test(v))
    throw Error('publication_review_identifier'); }
function integer(v, min = 0) { if (!Number.isSafeInteger(v) || v < min)
    throw Error('publication_review_number'); }
function freeze(value) { if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
} return value; }
function ascii(value) { return Buffer.from(canonicalVerificationJson(value).replace(/[\u007f-\uffff]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'))); }
/** Pure validation only. Neither this object nor its hash grants publication. */
export function parsePublicationOperationReview(raw) {
    const serialized = canonicalVerificationJson(raw);
    if (Buffer.byteLength(serialized) > 1024 ** 2 + 65536 || ascii(raw).length > 7 * 1024 ** 2)
        throw Error('publication_review_limit');
    const r = JSON.parse(serialized);
    shape(r, ['version', 'purpose', 'authorityId', 'challengeId', 'principal', 'requestSource', 'tuple', 'deadline']);
    if (r.version !== 1 || r.purpose !== 'completion-publication' || !['user', 'agent', 'scheduler'].includes(r.requestSource))
        throw Error('publication_review_purpose');
    id(r.authorityId);
    id(r.challengeId);
    shape(r.principal, ['uid', 'accountGeneration', 'auditSessionId']);
    integer(r.principal.uid, 1);
    integer(r.principal.auditSessionId, 1);
    if (r.principal.uid >= 0xffffffff || r.principal.auditSessionId > 0xffffffff || typeof r.principal.accountGeneration !== 'string' || !/^[A-F0-9]{8}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{12}$/.test(r.principal.accountGeneration))
        throw Error('publication_review_principal');
    r.tuple = parseVerificationTuple(r.tuple);
    shape(r.deadline, ['domainId', 'qualificationEpoch', 'notBefore', 'validUntil']);
    id(r.deadline.domainId);
    integer(r.deadline.qualificationEpoch);
    integer(r.deadline.notBefore);
    integer(r.deadline.validUntil);
    const d = r.deadline, t = r.tuple;
    if (d.domainId !== t.clockDomainId || d.qualificationEpoch !== t.clockQualificationEpoch || d.notBefore < t.notBefore || d.validUntil > t.validUntil || d.validUntil <= d.notBefore || d.validUntil - d.notBefore > 300000)
        throw Error('publication_review_deadline');
    return freeze(r);
}
/** Exactly the immutable ASCII bytes displayed and hashed by the native helper. */
export function publicationReviewBytes(raw) { return ascii(parsePublicationOperationReview(raw)); }
