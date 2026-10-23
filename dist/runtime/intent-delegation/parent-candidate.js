import { readInstalledCurrentOwner } from '../verification/installed-owner-state.js';
import { canonicalVerificationJson as json } from '../verification/protocol.js';
import { intentHostSubjectOwner } from '../verification/intent-host-subject.js';
import { parseIntentBusinessProjection, assertIntentCandidateFactSource } from './business-projection.js';
import { parseIntentNativeContracts } from './native-contract-journal.js';
/** Deterministic historical facts, not an issuer or a current authority check. */
export function deriveIntentParentBody(ledger, intentId, refs) {
    const record = ledger.intents.find(r => r.intentId === intentId), native = parseIntentNativeContracts(ledger.nativeContracts, ledger.sessionId).find(r => r.intentId === intentId);
    if (!record || !native || record.stages.length !== native.contract.stages.length || record.stages.some(s => s.status !== 'completed') || native.subjects.some(s => s.attempts.at(-1)?.phase !== 'enrolled') || refs.length !== native.contract.stages.length)
        throw Error('intent_parent_source');
    const children = native.contract.stages.map((stage, i) => {
        const child = ledger.publicationCandidates?.find(c => c.intentId === intentId && c.stageId === stage.stageId), ref = refs[i];
        if (!child || child.body.kind !== 'intent-stage' || !child.businessProjection)
            throw Error('intent_parent_stage_projection');
        const projection = parseIntentBusinessProjection(child.businessProjection, child, ledger), fact = projection.publications[0], application = child.applicationAttempts.at(-1), receiver = child.receiverAttempts?.find(r => r.requestId === projection.receiverRequestId);
        assertIntentCandidateFactSource(ledger, child);
        if (!receiver?.observation || receiver.status !== 'committed' || application?.phase !== 'ready' || json(ref.subject) !== json({ version: 1, sessionId: ledger.sessionId, intentId, stageId: stage.stageId }) || ref.candidateId !== child.id || ref.candidateRevision !== child.candidateRevision || ref.bindingHash !== child.bindingHash || ref.immutablePayloadHash !== fact.payloadHash || ref.operationId !== fact.operationId || ref.fullTupleHash !== fact.fullTupleHash || ref.committedBusinessRevision !== fact.businessRevision || json(fact.owner) !== json({ ...intentHostSubjectOwner(ref.subject), profileId: JSON.parse(application.route).owner.profileId }))
            throw Error('intent_parent_reference');
        return { child, owner: fact.owner };
    });
    return { kind: 'intent-parent', summary: children.at(-1).child.body.summary, stages: refs, artifacts: children.flatMap(({ child, owner }) => child.body.artifacts.map(a => ({ ...a, selection: a.selection.kind === 'local' ? { ...a.selection, kind: 'inherited', originOwner: owner, originalObligationId: a.selection.obligationId } : a.selection }))) };
}
/** Rejection-only route fence, including every original child before parent side effects. */
export function assertIntentParentRoutesCurrent(ledger, candidate) {
    if (candidate.stageId !== null)
        return;
    const native = parseIntentNativeContracts(ledger.nativeContracts, ledger.sessionId).find(r => r.intentId === candidate.intentId);
    if (!native)
        throw Error('intent_parent_route');
    for (const stage of native.contract.stages) {
        const child = ledger.publicationCandidates?.find(c => c.intentId === candidate.intentId && c.stageId === stage.stageId), application = child?.applicationAttempts.at(-1);
        const owner = intentHostSubjectOwner({ version: 1, sessionId: ledger.sessionId, intentId: candidate.intentId, stageId: stage.stageId });
        if (!child || application?.phase !== 'ready' || !application.route || json(readInstalledCurrentOwner(owner)) !== application.route)
            throw Error('intent_parent_route');
    }
}
