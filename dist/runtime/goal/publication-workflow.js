import { createInstalledCompletionPublisher } from '../verification/installed-completion-publication.js';
import { createInstalledGoalApplicationClient } from '../verification/installed-goal-application.js';
import { canonicalVerificationJson as json } from '../verification/protocol.js';
import { goalApplicationFromState } from './completion-intent.js';
import { createGoalPublicationAttempt, isGoalPublicationAttemptTerminal } from './publication-attempt.js';
// Scheduling convenience only: durable CAS and the controller's original request
// state arbitrate competing processes. No approval capability lives in this map.
const active = new WeakMap();
/** Main/CLI-owned workflow. The host supplies its actual source, never an agent
 * or renderer argument. All native/network waits are outside store transactions. */
export function createGoalPublicationWorkflow(options) {
    const store = options.store, now = options.now ?? Date.now, admission = options.assertAdmission;
    function assertAdmission() {
        const result = admission?.();
        if (result !== undefined) {
            void Promise.resolve(result).catch(() => { });
            throw Error('goal_publication_admission_sync');
        }
    }
    async function currentGoal(intent) {
        const document = await store.load(intent.application.sessionId);
        return !!document && document.state.status === 'active'
            && json(goalApplicationFromState(document.state)) === json(intent.application)
            && document.turns.some(turn => turn.goalId === intent.application.goalId && turn.epoch === intent.application.epoch && turn.turnId === intent.turnId);
    }
    async function applicationCurrent(intent, signal) {
        if (!await currentGoal(intent))
            return false;
        const client = createInstalledGoalApplicationClient(intent.application, 'scheduler');
        try {
            const result = await client.inspect(signal);
            signal?.throwIfAborted();
            return result.state === 'active' && result.pendingTransitionId === null && result.pendingTarget === null
                && json(result.current?.binding) === json(intent.application) && await currentGoal(intent);
        }
        finally {
            client.dispose();
        }
    }
    async function runOriginal(input) {
        const { sessionId, intentId, signal } = input;
        signal?.throwIfAborted();
        const intent = await store.loadCompletionIntent(sessionId, intentId);
        if (!intent)
            throw Error('goal_publication_intent_missing');
        const attempts = await store.listCompletionAttempts(sessionId, intentId);
        let attempt = attempts.at(-1);
        if (input.action === 'retry') {
            if (!attempt || !isGoalPublicationAttemptTerminal(attempt) || attempt.status === 'committed')
                throw Error('goal_publication_retry_not_ready');
            attempt = undefined;
        }
        if (!attempt) {
            if (input.action === 'recover')
                throw Error('goal_publication_attempt_missing');
            if (intent.status !== 'claimed' || !await applicationCurrent(intent, signal))
                throw Error('goal_publication_goal_not_current');
            assertAdmission();
            attempt = createGoalPublicationAttempt(intent, input.requestSource, now(), attempts.length + 1);
            await store.updateCompletionAttempt(sessionId, { expectedRevision: null, next: attempt });
        }
        else if (isGoalPublicationAttemptTerminal(attempt)) {
            if (attempt.status === 'committed')
                await store.finalizeCompletionAttempt(sessionId, attempt.attemptId);
            return attempt;
        }
        else {
            // A persisted record never restores the original in-memory approval object.
            input = { ...input, action: 'recover' };
        }
        const publisher = createInstalledCompletionPublisher({ ownerKind: 'goal', ownerId: intent.application.goalId }, attempt.requestSource);
        let original = attempt;
        async function save(changes) {
            const next = { ...original, ...changes, revision: original.revision + 1, updatedAt: Math.max(now(), original.updatedAt) };
            await store.updateCompletionAttempt(sessionId, { expectedRevision: original.revision, next });
            // Only after this exact CAS succeeds can this invocation promote the claim.
            original = next;
            if (next.status === 'committed')
                await store.finalizeCompletionAttempt(sessionId, next.attemptId);
            return next;
        }
        async function recover() {
            const result = await publisher.recoverRequest(original.attemptId, signal);
            if (result.status === 'not_prepared')
                return save({ status: 'not_prepared', retirement: result });
            if (result.status === 'not_approved')
                return save({ status: 'not_approved', challenge: result.challenge, retirement: result });
            // Persist a previously lost challenge before any receiver round trip.
            if (!original.challenge)
                await save({ status: 'prepared', challenge: result.challenge });
            else if (json(original.challenge) !== json(result.challenge))
                throw Error('goal_publication_challenge_changed');
            const observation = await publisher.reconcile(result.challenge, signal);
            if (observation.operationId !== result.operationId || observation.fullTupleHash !== result.fullTupleHash
                || json(observation.owner) !== json(result.owner))
                throw Error('goal_publication_operation_changed');
            return save({ status: observation.status === 'unknown' ? 'pending' : observation.status, observation });
        }
        try {
            if (input.action === 'recover')
                return await recover();
            if (!await applicationCurrent(intent, signal))
                return await recover();
            assertAdmission();
            const challenge = await publisher.prepareRequest(original.attemptId, signal);
            await save({ status: 'prepared', challenge });
            if (!await applicationCurrent(intent, signal))
                return await recover();
            await save({ status: 'authorizing' });
            assertAdmission();
            const observation = await publisher.approve(challenge, signal);
            return await save({ status: observation.status === 'unknown' ? 'pending' : observation.status, observation });
        }
        finally {
            publisher.dispose();
        }
    }
    return Object.freeze({
        run(raw) {
            const { signal, ...data } = raw, input = { ...structuredClone(data), signal };
            if (!['user', 'agent', 'scheduler'].includes(input.requestSource) || input.action === 'retry' && input.requestSource !== 'user') {
                return Promise.reject(Error('goal_publication_source'));
            }
            if (!['start', 'recover', 'retry'].includes(input.action))
                return Promise.reject(Error('goal_publication_action'));
            let running = active.get(store);
            if (!running)
                active.set(store, running = new Map());
            const key = json([input.sessionId, input.intentId]), existing = running.get(key);
            if (existing)
                return existing;
            const operation = runOriginal(input);
            running.set(key, operation);
            const done = () => { if (running.get(key) === operation)
                running.delete(key); };
            void operation.then(done, done);
            return operation;
        },
    });
}
