import { randomUUID } from 'node:crypto';
import { GOAL_APPLICATION_EVIDENCE_KINDS, parseGoalApplicationBinding } from '../verification/goal-application-binding.js';
import { canonicalVerificationJson as json } from '../verification/protocol.js';
export function goalApplicationFromState(state) {
    return parseGoalApplicationBinding({ version: 1, kind: 'goal', sessionId: state.sessionId, goalId: state.goalId,
        epoch: state.epoch, objective: state.objective, completionCriterion: state.completionCriterion ?? null,
        expectedEvidenceKinds: GOAL_APPLICATION_EVIDENCE_KINDS.filter(kind => state.expectedEvidenceKinds.includes(kind)) });
}
export function createGoalCompletionIntent(input) {
    return parseIntent({ intentId: `goal_completion_${randomUUID()}`, revision: 1,
        application: goalApplicationFromState(input.state), taskId: input.taskId, turnId: input.turnId, summary: input.summary,
        status: 'claimed', challenge: null, observation: null, createdAt: input.now, updatedAt: input.now });
}
function id(value) {
    if (typeof value !== 'string' || !value || Buffer.byteLength(value) > 160 || /[\x00-\x1f\x7f]/.test(value))
        throw Error('goal_intent_identity');
}
function hash(value) { if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value))
    throw Error('goal_intent_hash'); }
function keys(value, expected) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw Error('goal_intent_shape');
    const actual = Object.keys(value);
    if (actual.length !== expected.length || actual.some(key => !expected.includes(key)))
        throw Error('goal_intent_shape');
}
export function parseGoalCompletionIntent(raw) {
    const value = JSON.parse(json(raw));
    keys(value, ['intentId', 'revision', 'application', 'taskId', 'turnId', 'summary', 'status', 'challenge', 'observation', 'createdAt', 'updatedAt']);
    for (const name of [value.intentId, value.taskId, value.turnId])
        id(name);
    value.application = parseGoalApplicationBinding(value.application);
    if (!Number.isSafeInteger(value.revision) || value.revision < 1 || ![value.createdAt, value.updatedAt].every(n => Number.isSafeInteger(n) && n >= 0)
        || value.updatedAt < value.createdAt || typeof value.summary !== 'string' || !value.summary.trim() || value.summary.length > 16000)
        throw Error('goal_intent_value');
    if (!['claimed', 'prepared', 'authorizing', 'pending', 'committed', 'cancelled', 'superseded'].includes(value.status))
        throw Error('goal_intent_status');
    if (value.challenge !== null) {
        const c = value.challenge;
        keys(c, ['challengeId', 'owner', 'fullTupleHash', 'deadline']);
        id(c.challengeId);
        hash(c.fullTupleHash);
        keys(c.owner, ['profileId', 'ownerKind', 'ownerId']);
        id(c.owner.profileId);
        if (c.owner.ownerKind !== 'goal' || c.owner.ownerId !== value.application.goalId)
            throw Error('goal_intent_challenge_owner');
        keys(c.deadline, ['domainId', 'qualificationEpoch', 'notBefore', 'validUntil']);
        id(c.deadline.domainId);
        const d = c.deadline;
        if (![d.qualificationEpoch, d.notBefore, d.validUntil].every(n => Number.isSafeInteger(n) && n >= 0)
            || d.validUntil <= d.notBefore || d.validUntil - d.notBefore > 300000)
            throw Error('goal_intent_deadline');
    }
    if (value.observation !== null) {
        const o = value.observation;
        keys(o, ['status', 'owner', 'operationId', 'fullTupleHash', 'businessRevision', 'currentVerification']);
        id(o.operationId);
        if (!value.challenge || json(o.owner) !== json(value.challenge.owner) || o.fullTupleHash !== value.challenge.fullTupleHash
            || !Number.isSafeInteger(o.businessRevision) || o.businessRevision < 1 || !['committed', 'cancelled', 'unknown'].includes(o.status)
            || !['valid', 'needs_revalidation', 'unavailable'].includes(o.currentVerification))
            throw Error('goal_intent_observation');
    }
    if (value.status === 'claimed' && (value.challenge || value.observation))
        throw Error('goal_intent_claim');
    if (['prepared', 'authorizing', 'pending', 'committed', 'cancelled'].includes(value.status) && !value.challenge)
        throw Error('goal_intent_challenge');
    if (['committed', 'cancelled'].includes(value.status) && value.observation?.status !== value.status)
        throw Error('goal_intent_terminal');
    if (['claimed', 'prepared', 'authorizing', 'superseded'].includes(value.status) && value.observation)
        throw Error('goal_intent_observation');
    if (value.status === 'pending' && value.observation && value.observation.status !== 'unknown')
        throw Error('goal_intent_observation');
    return value;
}
const parseIntent = parseGoalCompletionIntent;
const transitions = {
    claimed: ['prepared', 'superseded'], prepared: ['authorizing', 'superseded'],
    authorizing: ['pending', 'committed', 'cancelled'], pending: ['pending', 'committed', 'cancelled'],
    committed: [], cancelled: [], superseded: [],
};
/** Pure captured-journal check for the legacy intent transition path. The
 * publication-attempt finalizer has a separate, original-store-bound path. */
export function validateGoalCompletionIntentRevision(intent) {
    intent = parseGoalCompletionIntent(intent);
    let states = new Set(['claimed']);
    for (let remaining = intent.revision - 1; remaining > 0; remaining--) {
        const next = new Set([...states].flatMap(state => transitions[state]));
        if (next.size === states.size && [...next].every(state => states.has(state)))
            break;
        states = next;
    }
    if (!states.has(intent.status))
        throw Error('goal_intent_revision_state');
}
/** Called inside the actual store's CAS/transaction, never an authority issuer. */
export function applyGoalCompletionIntentUpdate(current, update, creationState) {
    if (!update)
        return structuredClone(current);
    const next = parseIntent(update.next), found = current.find(row => row.intentId === next.intentId);
    if ((found?.revision ?? null) !== update.expectedRevision)
        throw Error('goal_intent_stale_revision');
    if (!found) {
        if (!creationState || json(next.application) !== json(goalApplicationFromState(creationState)))
            throw Error('goal_intent_identity');
        if (next.revision !== 1 || next.status !== 'claimed')
            throw Error('goal_intent_initial');
        if (current.some(row => row.application.goalId === next.application.goalId && row.application.epoch === next.application.epoch && row.turnId === next.turnId))
            throw Error('goal_intent_duplicate_turn');
        return [...structuredClone(current), next];
    }
    if (next.revision !== found.revision + 1)
        throw Error('goal_intent_revision');
    if (['application', 'taskId', 'turnId', 'summary', 'createdAt'].some(key => json(next[key]) !== json(found[key])))
        throw Error('goal_intent_identity');
    if (found.challenge && json(next.challenge) !== json(found.challenge))
        throw Error('goal_intent_challenge_changed');
    if (found.observation && (!next.observation || found.observation.operationId !== next.observation.operationId))
        throw Error('goal_intent_operation_changed');
    if (next.updatedAt < found.updatedAt || !transitions[found.status].includes(next.status))
        throw Error('goal_intent_transition');
    return current.map(row => row.intentId === next.intentId ? next : structuredClone(row));
}
