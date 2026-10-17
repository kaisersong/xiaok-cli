import { consumeGoalNativeProjection } from './native-mutation-projection.js';
import { createHash } from 'node:crypto';
import { readInstalledCurrentOwner } from '../verification/installed-owner-state.js';
import { createInstalledGoalApplicationClient } from '../verification/installed-goal-application.js';
import { createInstalledCompletionPublisher } from '../verification/installed-completion-publication.js';
import { parseActiveGoalApplicationBinding } from '../verification/goal-application-binding.js';
import { canonicalVerificationJson as json } from '../verification/protocol.js';
import { goalApplicationFromState } from './completion-intent.js';
import { reduceGoal } from './reducer.js';
const projections = new WeakMap();
// Match the stores' JSON representation: optional Goal fields may be undefined.
const goalJson = (value) => json(JSON.parse(JSON.stringify(value)));
const digest = (value) => createHash('sha256').update(goalJson(value)).digest('hex');
function requested(state) { return { ownerKind: 'goal', ownerId: state.goalId }; }
/** Snapshot JSON before a store yields without cloning the private, one-attempt ticket. */
function captureGoalDescriptors(fields) {
    const data = Object.create(null);
    for (const [key, descriptor] of Object.entries(fields)) {
        if (!('value' in descriptor))
            throw Error('goal_projection_commit_accessor');
        if (key !== 'completionProjection' && key !== 'nativeProjection')
            data[key] = descriptor.value;
    }
    const completionProjection = fields.completionProjection?.value, nativeProjection = fields.nativeProjection?.value;
    return { ...structuredClone(data), ...(completionProjection ? { completionProjection } : {}),
        ...(nativeProjection ? { nativeProjection } : {}) };
}
export function captureGoalCommit(input) {
    return captureGoalDescriptors(Object.getOwnPropertyDescriptors(input));
}
function commitDigest(input) {
    const { completionProjection: ignored, ...data } = input;
    return digest(data);
}
function assertTransition(document, input) {
    const state = document.state;
    if (state.revision !== input.expectedRevision || state.sessionId !== input.sessionId
        || input.next.sessionId !== state.sessionId || state.goalId !== input.next.goalId
        || state.epoch !== input.next.epoch || input.next.status !== 'complete'
        || typeof input.next.terminalReason !== 'string' || !Number.isSafeInteger(input.next.updatedAt)
        || input.next.updatedAt < state.updatedAt || input.turns.length > 1)
        throw Error('goal_projection_transition');
    const turn = input.turns[0], common = { reason: input.next.terminalReason, now: input.next.updatedAt };
    if (turn && (turn.goalId !== state.goalId || turn.epoch !== state.epoch || !turn.turnId
        || document.turns.some(t => t.goalId === turn.goalId && t.epoch === turn.epoch && t.turnId === turn.turnId)))
        throw Error('goal_projection_turn');
    if (input.evidence.some(e => !turn || e.goalId !== state.goalId || e.epoch !== state.epoch || e.goalTurnId !== turn.turnId))
        throw Error('goal_projection_evidence');
    const next = turn ? reduceGoal(state, { type: 'settle_turn', turnId: turn.turnId, tokensUsed: turn.tokensUsed,
        activeWallClockMs: turn.activeWallClockMs, terminalDecision: { kind: 'complete', reason: common.reason }, now: common.now })
        : reduceGoal(state, { type: 'complete', ...common });
    if (goalJson(next) !== goalJson(input.next))
        throw Error('goal_projection_transition');
    for (const event of input.events)
        if (event.goalId !== state.goalId || event.revision !== next.revision
            || !['user', 'runtime'].includes(event.actor))
            throw Error('goal_projection_event');
}
function activeApplication(raw, expected) {
    const value = JSON.parse(json(raw));
    if (!value || Object.keys(value).sort().join(',') !== 'current,pendingTarget,pendingTransitionId,state'
        || value.state !== 'active' || value.pendingTransitionId !== null || value.pendingTarget !== null)
        throw Error('goal_projection_application_pending');
    const active = parseActiveGoalApplicationBinding(value.current);
    if (json(active.binding) !== expected)
        throw Error('goal_projection_application_changed');
    return active;
}
/** Observe the original signed receiver commit through fixed installed endpoints.
 * This grants only a cache projection of that historical commit, never current
 * verification or permission to execute. There is no injectable authority port. */
export async function authorizeGoalCompletionProjection(store, raw, signal) {
    if (raw.completionProjection)
        throw Error('goal_projection_already_authorized');
    const input = captureGoalCommit(raw);
    if (input.next.status !== 'complete')
        return input;
    signal?.throwIfAborted();
    const route = readInstalledCurrentOwner(requested(input.next));
    if (route.kind === 'ordinary')
        return input;
    if (route.kind !== 'migrated' && route.kind !== 'protected-unregistered')
        throw Error('goal_projection_owner_unavailable');
    const routeKey = json(route), document = await store.load(input.sessionId);
    if (!document)
        throw Error('goal_projection_document_missing');
    assertTransition(document, input);
    const expected = json(goalApplicationFromState(document.state));
    if (input.completionIntent)
        throw Error('goal_projection_intent_write');
    if (document.state.pendingCompletionIntentId && document.state.pendingCompletionIntentId !== input.completionIntentId)
        throw Error('goal_projection_pending_intent');
    const claims = (document.completionIntents ?? []).filter(intent => json(intent.application) === expected);
    if (claims.length && !input.completionIntentId)
        throw Error('goal_projection_intent_required');
    const intent = input.completionIntentId ? await store.loadCompletionIntent(input.sessionId, input.completionIntentId) : null;
    if (input.completionIntentId && (!intent || intent.status !== 'committed' || !intent.challenge
        || !intent.observation || intent.observation.status !== 'committed' || json(intent.application) !== expected
        || json(intent.challenge.owner) !== json(route.owner) || json(intent.observation.owner) !== json(route.owner)
        || intent.observation.fullTupleHash !== intent.challenge.fullTupleHash
        || input.next.terminalReason !== intent.summary))
        throw Error('goal_projection_intent');
    const client = createInstalledGoalApplicationClient(goalApplicationFromState(document.state), 'scheduler');
    let publisher;
    function current() {
        signal?.throwIfAborted();
        if (json(readInstalledCurrentOwner(requested(input.next))) !== routeKey)
            throw Error('goal_projection_owner_changed');
    }
    async function application() {
        current();
        const result = activeApplication(await client.inspect(signal), expected);
        current();
        return result;
    }
    try {
        const beforeApplication = await application();
        publisher = createInstalledCompletionPublisher(requested(input.next), 'scheduler');
        const observation = await publisher.observe(signal), p = observation.publication;
        if (json(observation.owner) !== json(route.owner) || observation.currentVerification !== 'valid'
            || p.status !== 'committed' || !p.current)
            throw Error('goal_projection_publication_not_current');
        if (intent && (intent.observation.operationId !== p.operationId
            || intent.observation.fullTupleHash !== p.fullTupleHash
            || intent.observation.businessRevision !== observation.businessRevision))
            throw Error('goal_projection_intent_publication');
        const payload = await publisher.readPayload(observation, signal);
        if (json(payload.owner) !== json(route.owner) || payload.businessRevision !== observation.businessRevision
            || payload.operationId !== p.operationId || payload.fullTupleHash !== p.fullTupleHash
            || !Buffer.isBuffer(payload.bytes) || payload.bytes.length > 32 * 1024 ** 2
            || createHash('sha256').update(payload.bytes).digest('hex') !== payload.payloadHash)
            throw Error('goal_projection_payload');
        const body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(payload.bytes));
        if (body.version !== 1 || json(body.owner) !== json(route.owner) || !Buffer.from(json(body)).equals(payload.bytes)
            || json(parseActiveGoalApplicationBinding(body.application)) !== json(beforeApplication))
            throw Error('goal_projection_payload_application');
        if (json(await application()) !== json(beforeApplication) || json(await publisher.observe(signal)) !== json(observation))
            throw Error('goal_projection_publication_changed');
        if (intent && json(await store.loadCompletionIntent(input.sessionId, intent.intentId)) !== json(intent))
            throw Error('goal_projection_intent_changed');
        current();
        const ticket = Object.freeze({});
        projections.set(ticket, { store, route: routeKey, current: digest(document.state), commit: commitDigest(input), publication: json({
                owner: payload.owner, businessRevision: payload.businessRevision, operationId: payload.operationId,
                fullTupleHash: payload.fullTupleHash, payloadHash: payload.payloadHash, application: beforeApplication,
            }) });
        return { ...input, completionProjection: ticket };
    }
    finally {
        publisher?.dispose();
        client.dispose();
    }
}
/** Actual store queue/transaction boundary. Public observations and copied tokens
 * cannot authorize writes; all original data is bound to the one consuming store. */
export function captureGoalCommitForStore(store, raw) {
    // Inspect data descriptors without invoking either token's accessor. Burn both
    // independently before any capture error can preserve the sibling capability.
    const fields = Object.getOwnPropertyDescriptors(raw), token = fields.completionProjection?.value;
    const projection = token && typeof token === 'object' ? projections.get(token) : undefined;
    if (token && typeof token === 'object')
        projections.delete(token);
    const assertNativeProjection = consumeGoalNativeProjection(store, fields.nativeProjection?.value);
    const input = captureGoalDescriptors(fields);
    // Burn on entry, including failed CAS, corrupt input and failed transactions.
    // The continuation is local to the actual store; it cannot mint another ticket.
    let checked = false;
    return { input, assertProjection(current) {
            if (checked)
                throw Error('goal_projection_consumed');
            checked = true;
            if (input.next.status !== 'complete') {
                assertNativeProjection(current, input);
                if (token)
                    throw Error('goal_projection_noncompletion');
                return;
            }
            const route = readInstalledCurrentOwner(requested(input.next));
            if (route.kind === 'ordinary' && !token) {
                assertNativeProjection(current, input);
                return;
            }
            if (!projection || projection.store !== store || !current || projection.route !== json(route)
                || projection.current !== digest(current) || projection.commit !== commitDigest(input))
                throw Error('goal_projection_required');
            assertNativeProjection(current, input);
        } };
}
