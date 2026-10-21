import { captureIntentStageContext } from './stage-context.js';
import { projectIntentBusinessLedger } from './business-projection.js';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { captureIntentData } from './data.js';
import { canonicalVerificationJson as json } from '../verification/protocol.js';
import { parsePublicationChallenge, parsePublicationObservation } from '../verification/publication-client.js';
import { parseIntentPublicationCandidates, intentPublicationRouteVector } from './publication-candidate-journal.js';
import { intentNativeLedgerHash } from './native-contract-journal.js';
import { assertSessionWriteOwnership } from './ownership.js';
const shape = (v, keys) => { if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).sort().join(',') !== keys.split(' ').sort().join(','))
    throw Error('intent_receiver_shape'); };
const id = (v) => typeof v === 'string' && !!v && Buffer.byteLength(v) <= 160 && !/[\x00-\x1f\x7f]/.test(v);
const edges = Object.freeze({ preparing: ['prepared', 'pending', 'committed', 'cancelled', 'not_prepared', 'not_approved'], prepared: ['authorizing', 'pending', 'committed', 'cancelled', 'not_approved'], authorizing: ['pending', 'committed', 'cancelled', 'not_approved'], pending: ['pending', 'committed', 'cancelled'], committed: [], cancelled: [], not_prepared: [], not_approved: [] });
export function parseIntentReceiverAttempts(raw, candidate) {
    const values = captureIntentData(raw === undefined ? [] : raw);
    if (!Array.isArray(values) || values.length > 32)
        throw Error('intent_receiver_limit');
    const ids = new Set();
    for (let index = 0; index < values.length; index++) {
        const r = values[index], prior = values[index - 1];
        shape(r, 'requestId candidateId applicationRequestId bindingHash sourceHash route originalSource ordinal revision status challenge observation retirement createdAt updatedAt');
        const application = candidate.applicationAttempts.find(a => a.requestId === r.applicationRequestId);
        if (!id(r.requestId) || ids.has(r.requestId) || r.candidateId !== candidate.id || !application || application.phase !== 'ready' || r.bindingHash !== candidate.bindingHash || r.sourceHash !== candidate.sourceHash || r.route !== application.route || r.originalSource !== 'user' || r.ordinal !== index + 1 || !Number.isSafeInteger(r.revision) || r.revision < 1 || !Number.isSafeInteger(r.createdAt) || r.createdAt < candidate.createdAt || !Number.isSafeInteger(r.updatedAt) || r.updatedAt < r.createdAt || !Object.hasOwn(edges, r.status) || prior && (!['not_prepared', 'not_approved'].includes(prior.status) || r.createdAt < prior.updatedAt))
            throw Error('intent_receiver_identity');
        ids.add(r.requestId);
        const owner = JSON.parse(r.route).owner;
        if (r.challenge !== null)
            parsePublicationChallenge(r.challenge, owner);
        if (r.observation !== null) {
            if (!r.challenge)
                throw Error('intent_receiver_observation');
            parsePublicationObservation(r.observation, r.challenge, owner);
        }
        if (r.status === 'preparing') {
            if (r.revision !== 1 || r.updatedAt !== r.createdAt || r.challenge !== null || r.observation !== null || r.retirement !== null)
                throw Error('intent_receiver_phase');
            continue;
        }
        if (r.revision < 2 || r.status === 'authorizing' && r.revision !== 3 || ['prepared', 'not_prepared'].includes(r.status) && r.revision !== 2)
            throw Error('intent_receiver_revision');
        if (r.status === 'not_prepared') {
            shape(r.retirement, 'status');
            if (r.retirement?.status !== 'not_prepared' || r.challenge !== null || r.observation !== null)
                throw Error('intent_receiver_phase');
            continue;
        }
        if (!r.challenge)
            throw Error('intent_receiver_challenge');
        if (r.status === 'not_approved') {
            shape(r.retirement, 'status owner challengeId operationId fullTupleHash challenge');
            const f = r.retirement;
            if (!f || f.status !== 'not_approved' || !id(f.operationId) || json(f.owner) !== json(owner) || f.challengeId !== r.challenge.challengeId || f.fullTupleHash !== r.challenge.fullTupleHash || json(f.challenge) !== json(r.challenge) || r.observation !== null)
                throw Error('intent_receiver_phase');
            continue;
        }
        if (r.retirement !== null || ['prepared', 'authorizing'].includes(r.status) && r.observation !== null || r.status === 'pending' && r.observation?.status !== 'unknown' || ['committed', 'cancelled'].includes(r.status) && r.observation?.status !== r.status)
            throw Error('intent_receiver_phase');
    }
    return values;
}
export function assertIntentReceiverRetained(before, after) {
    const a = parseIntentReceiverAttempts(before.receiverAttempts, before), b = parseIntentReceiverAttempts(after.receiverAttempts, after), { receiverAttempts: _a, ...x } = before, { receiverAttempts: _b, ...y } = after;
    if (!isDeepStrictEqual(x, y) || b.length < a.length || b.length > a.length + 1)
        throw Error('intent_receiver_original');
    if (b.length === a.length + 1) {
        if (a.some((r, i) => !isDeepStrictEqual(r, b[i])) || b.at(-1).status !== 'preparing')
            throw Error('intent_receiver_original');
        return;
    }
    if (a.every((r, i) => isDeepStrictEqual(r, b[i])))
        return;
    const old = a.at(-1), next = b.at(-1);
    if (a.slice(0, -1).some((r, i) => !isDeepStrictEqual(r, b[i])) || !edges[old.status].includes(next.status) || next.revision !== old.revision + 1 || next.updatedAt < old.updatedAt)
        throw Error('intent_receiver_transition');
    const pick = ({ revision, status, challenge, observation, retirement, updatedAt, ...rest }) => rest;
    if (!isDeepStrictEqual(pick(old), pick(next)) || old.challenge && json(old.challenge) !== json(next.challenge) || old.observation && (!next.observation || ['operationId', 'fullTupleHash', 'businessRevision'].some(k => old.observation[k] !== next.observation[k])))
        throw Error('intent_receiver_original');
}
export function applyIntentReceiverMutation(previous, input) {
    const next = captureIntentData(previous), ledger = next.intentDelegation;
    if (!ledger || previous.sessionId !== input.sessionId || intentNativeLedgerHash(ledger) !== input.expectedLedgerHash)
        throw Error('intent_receiver_stale');
    assertSessionWriteOwnership(ledger, input.instanceId, 'intent receiver publication');
    if (input.action.kind === 'project') {
        if (input.requestSource !== 'user')
            throw Error('intent_receiver_source');
        const c = ledger.publicationCandidates?.find(c => c.id === input.candidateId), r = c?.receiverAttempts?.at(-1);
        if (!r || intentPublicationRouteVector(ledger, input.candidateId) !== r.route)
            throw Error('intent_receiver_route');
        const context = input.action.projection.nextStageContext;
        if (context === undefined)
            throw Error('intent_stage_context_required');
        if (context !== null && !isDeepStrictEqual(context, captureIntentStageContext(previous, context.stageId)))
            throw Error('intent_stage_context_changed');
        next.intentDelegation = projectIntentBusinessLedger(ledger, input.candidateId, input.action.projection);
        next.updatedAt = Math.max(next.updatedAt, input.now);
        return next;
    }
    const candidates = captureIntentData(parseIntentPublicationCandidates(ledger)), index = candidates.findIndex(c => c.id === input.candidateId), original = candidates[index];
    if (!original)
        throw Error('intent_receiver_candidate');
    const candidate = captureIntentData(original), rows = parseIntentReceiverAttempts(candidate.receiverAttempts, candidate), last = rows.at(-1), a = input.action;
    if (!['user', 'scheduler'].includes(input.requestSource) || !Number.isSafeInteger(input.now) || input.now < ledger.updatedAt)
        throw Error('intent_receiver_source');
    if (a.kind === 'reserve') {
        const record = ledger.intents.find(r => r.intentId === candidate.intentId), app = candidate.applicationAttempts.at(-1);
        if (input.requestSource !== 'user' || rows.length >= 32 || last && !['not_prepared', 'not_approved'].includes(last.status) || app?.phase !== 'ready' || a.route !== app.route || intentPublicationRouteVector(ledger, candidate.id) !== a.route || ledger.activeIntentId !== candidate.intentId || (candidate.stageId === null ? !record || record.stages.some(s => s.status !== 'completed') : record?.activeStageId !== candidate.stageId) || record?.overallStatus !== 'publication_pending')
            throw Error('intent_receiver_current');
        rows.push({ requestId: randomUUID(), candidateId: candidate.id, applicationRequestId: app.requestId, bindingHash: candidate.bindingHash, sourceHash: candidate.sourceHash, route: a.route, originalSource: 'user', ordinal: rows.length + 1, revision: 1, status: 'preparing', challenge: null, observation: null, retirement: null, createdAt: input.now, updatedAt: input.now });
    }
    else {
        if (!last)
            throw Error('intent_receiver_missing');
        if (intentPublicationRouteVector(ledger, candidate.id) !== last.route)
            throw Error('intent_receiver_route');
        const row = captureIntentData(last);
        if (a.kind === 'prepared') {
            if (input.requestSource !== 'user' || last.status !== 'preparing')
                throw Error('intent_receiver_phase');
            row.challenge = a.challenge;
            row.status = 'prepared';
        }
        else if (a.kind === 'authorizing') {
            if (input.requestSource !== 'user' || last.status !== 'prepared')
                throw Error('intent_receiver_phase');
            row.status = 'authorizing';
        }
        else if (a.kind === 'retire') {
            if (a.fact.status === 'settlement_exists')
                throw Error('intent_receiver_retirement');
            row.retirement = a.fact;
            row.status = a.fact.status;
            if (a.fact.status === 'not_approved')
                row.challenge = a.fact.challenge;
        }
        else {
            row.challenge = a.challenge;
            row.observation = a.observation;
            row.status = a.observation.status === 'unknown' ? 'pending' : a.observation.status;
        }
        if (isDeepStrictEqual(row, last))
            return next;
        row.revision++;
        row.updatedAt = input.now;
        rows[rows.length - 1] = row;
    }
    candidate.receiverAttempts = rows;
    assertIntentReceiverRetained(original, candidate);
    candidates[index] = candidate;
    ledger.publicationCandidates = candidates;
    ledger.updatedAt = Math.max(ledger.updatedAt, input.now);
    next.updatedAt = Math.max(next.updatedAt, input.now);
    parseIntentPublicationCandidates(ledger);
    return next;
}
