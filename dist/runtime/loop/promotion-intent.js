import { canonicalVerificationJson as json } from '../verification/protocol.js';
import { captureLoopProducerValue } from './producer-value.js';
import { publicationFields, publicationIdentity } from './publication-attempt.js';
/** Durable user intent, never a current verification capability. */
export function parseAssistantPromotionIntent(raw) {
    const v = captureLoopProducerValue(raw);
    publicationFields(v, ['candidateId', 'runId', 'revision', 'source', 'state', 'target', 'targetRef', 'createdAt', 'updatedAt']);
    publicationIdentity(v.candidateId);
    publicationIdentity(v.runId);
    if (v.source !== 'user' || !['accepting', 'accepted'].includes(v.state) || !Number.isSafeInteger(v.revision) || v.revision !== (v.state === 'accepting' ? 1 : 2) || !Number.isSafeInteger(v.createdAt) || !Number.isSafeInteger(v.updatedAt) || v.updatedAt < v.createdAt)
        throw Error('assistant_promotion_intent');
    const t = v.target;
    const required = ['candidateId', 'loopRunId', 'targetId', 'title', 'content', 'scope', 'provenance'];
    if (!t || typeof t !== 'object' || Object.keys(t).some(k => ![...required, 'projectId', 'projectCwd', 'collectionId'].includes(k)) || required.some(k => !Object.hasOwn(t, k)))
        throw Error('assistant_promotion_target');
    if (t.candidateId !== v.candidateId || t.loopRunId !== v.runId || !['global', 'project'].includes(t.scope) || typeof t.title !== 'string' || typeof t.content !== 'string')
        throw Error('assistant_promotion_target');
    publicationIdentity(t.targetId);
    for (const k of ['projectId', 'projectCwd', 'collectionId'])
        if (t[k] !== undefined && (typeof t[k] !== 'string' || !t[k]))
            throw Error('assistant_promotion_target');
    publicationFields(t.provenance, ['kind', 'candidateId', 'loopRunId', 'evidenceRefs']);
    if (t.provenance.kind !== 'assistant_candidate' || t.provenance.candidateId !== v.candidateId || t.provenance.loopRunId !== v.runId || !Array.isArray(t.provenance.evidenceRefs))
        throw Error('assistant_promotion_target');
    for (const r of t.provenance.evidenceRefs) {
        publicationFields(r, ['kind', 'id']);
        publicationIdentity(r.kind);
        publicationIdentity(r.id);
    }
    if ((v.state === 'accepting' && v.targetRef !== null) || (v.state === 'accepted' && (typeof v.targetRef !== 'string' || !v.targetRef)))
        throw Error('assistant_promotion_target');
    if (Buffer.byteLength(json(v)) > 65536)
        throw Error('assistant_promotion_size');
    const freeze = (x) => { if (x && typeof x === 'object') {
        Object.values(x).forEach(freeze);
        Object.freeze(x);
    } return x; };
    return freeze(v);
}
