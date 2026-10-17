import { captureGoalCommitForStore } from './completion-projection.js';
import { applyGoalCompletionIntentUpdate } from './completion-intent.js';
import { assertGoalTurnAppend } from './turn-ledger.js';
import { applyGoalPublicationAttemptUpdate, finalizeGoalPublicationAttempt } from './publication-attempt.js';
export class InMemoryGoalStore {
    documents = new Map();
    failNextCommit = false;
    async load(sessionId) {
        const document = this.documents.get(sessionId);
        return document ? structuredClone(document) : null;
    }
    async updateCompletionIntent(sessionId, update) {
        const captured = structuredClone(update), current = this.documents.get(sessionId);
        if (!current)
            throw Error('goal_intent_document_missing');
        if (captured.next.application.sessionId !== sessionId)
            throw Error('goal_intent_identity');
        const completionIntents = applyGoalCompletionIntentUpdate(current.completionIntents ?? [], captured);
        this.documents.set(sessionId, { ...current, completionIntents });
    }
    async loadCompletionIntent(sessionId, intentId) {
        const intent = this.documents.get(sessionId)?.completionIntents?.find(row => row.intentId === intentId
            && row.application.sessionId === sessionId);
        return intent ? structuredClone(intent) : null;
    }
    async listCompletionAttempts(sessionId, intentId) {
        return structuredClone(this.documents.get(sessionId)?.completionAttempts?.filter(row => row.intentId === intentId && row.application.sessionId === sessionId) ?? []);
    }
    async updateCompletionAttempt(sessionId, update) {
        const captured = structuredClone(update), document = this.documents.get(sessionId);
        const intent = document?.completionIntents?.find(row => row.intentId === captured.next.intentId && row.application.sessionId === sessionId);
        if (!document || !intent)
            throw Error('goal_attempt_intent_missing');
        const completionAttempts = applyGoalPublicationAttemptUpdate(document.completionAttempts ?? [], intent, captured);
        this.documents.set(sessionId, { ...document, completionAttempts });
    }
    async finalizeCompletionAttempt(sessionId, attemptId) {
        const document = this.documents.get(sessionId);
        const attempt = document?.completionAttempts?.find(row => row.attemptId === attemptId && row.application.sessionId === sessionId);
        const intent = document?.completionIntents?.find(row => row.intentId === attempt?.intentId && row.application.sessionId === sessionId);
        if (!document || !intent)
            throw Error('goal_attempt_intent_missing');
        const result = finalizeGoalPublicationAttempt(intent, document.completionAttempts ?? [], attemptId);
        this.documents.set(sessionId, { ...document, completionIntents: document.completionIntents.map(row => row.intentId === result.intentId ? result : row) });
        return structuredClone(result);
    }
    async commit(input) {
        const captured = captureGoalCommitForStore(this, input);
        input = captured.input;
        const { assertProjection } = captured;
        const current = this.documents.get(input.sessionId);
        const revision = current?.state.revision ?? null;
        if (revision !== input.expectedRevision) {
            throw new Error(`stale goal revision: expected ${input.expectedRevision}, found ${revision}`);
        }
        assertProjection(current?.state ?? null);
        if (this.failNextCommit) {
            this.failNextCommit = false;
            throw new Error('injected goal commit failure');
        }
        assertGoalTurnAppend(current?.turns ?? [], input.turns, input.next);
        this.documents.set(input.sessionId, {
            state: structuredClone(input.next),
            events: [...(current?.events ?? []), ...structuredClone(input.events)],
            turns: [...(current?.turns ?? []), ...structuredClone(input.turns)],
            evidence: [...(current?.evidence ?? []), ...structuredClone(input.evidence)],
            completionIntents: applyGoalCompletionIntentUpdate(current?.completionIntents ?? [], input.completionIntent, input.next),
            completionAttempts: structuredClone(current?.completionAttempts ?? []),
        });
    }
}
