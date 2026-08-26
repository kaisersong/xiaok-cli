import { randomUUID } from 'node:crypto';
import { createGoalState, reduceGoal } from './reducer.js';
export class GoalService {
    options;
    now;
    constructor(options) {
        this.options = options;
        this.now = options.now ?? Date.now;
    }
    load(sessionId) {
        return this.options.store.load(sessionId);
    }
    async create(context, input) {
        this.requireSource(context, ['user']);
        await this.assertOwned(context);
        if (context.expectedRevision !== null)
            throw new Error('Goal create expects null revision');
        const existing = await this.options.store.load(context.sessionId);
        if (existing && !['complete', 'cancelled'].includes(existing.state.status)) {
            throw new Error('A current goal already exists');
        }
        const state = createGoalState({ ...input, sessionId: context.sessionId, now: this.now() });
        await this.options.store.commit({
            sessionId: context.sessionId,
            expectedRevision: existing?.state.revision ?? null,
            next: state,
            events: [this.event(state, context, 'created')],
            turns: [],
            evidence: [],
        });
        return state;
    }
    async fork(context, source) {
        this.requireSource(context, ['user']);
        await this.assertOwned(context);
        if (context.expectedRevision !== null)
            throw new Error('Goal fork expects null revision');
        const existing = await this.options.store.load(context.sessionId);
        if (existing)
            throw new Error('Target session already has a Goal');
        const state = createGoalState({
            sessionId: context.sessionId,
            objective: source.objective,
            completionCriterion: source.completionCriterion,
            expectedEvidenceKinds: source.expectedEvidenceKinds,
            turnLimit: source.budgetLimits.turnLimit,
            forkedFromGoalId: source.goalId,
            now: this.now(),
        });
        await this.options.store.commit({
            sessionId: context.sessionId,
            expectedRevision: null,
            next: state,
            events: [this.event(state, context, 'forked')],
            turns: [],
            evidence: [],
        });
        return state;
    }
    async pause(context, reason) {
        this.requireSource(context, ['user', 'runtime']);
        return await this.mutate(context, 'paused', state => reduceGoal(state, {
            type: 'pause', reason, now: this.now(),
        }));
    }
    async resume(context, input = {}) {
        this.requireSource(context, ['user']);
        return await this.mutate(context, 'resumed', state => reduceGoal(state, {
            type: 'resume', turnLimit: input.turnLimit, now: this.now(),
        }));
    }
    async cancel(context, reason) {
        this.requireSource(context, ['user']);
        return await this.mutate(context, 'cancelled', state => reduceGoal(state, {
            type: 'cancel', reason, now: this.now(),
        }));
    }
    async replace(context, input) {
        this.requireSource(context, ['user']);
        return await this.mutate(context, 'replaced', state => reduceGoal(state, {
            type: 'replace', ...input, now: this.now(),
        }));
    }
    async complete(context, reason) {
        this.requireSource(context, ['user', 'runtime']);
        return await this.mutate(context, 'completed', state => reduceGoal(state, {
            type: 'complete', reason, now: this.now(),
        }));
    }
    async noteBlockedClaim(context, input) {
        this.requireSource(context, ['runtime']);
        return await this.mutate(context, 'blocker_noted', state => reduceGoal(state, {
            type: 'note_blocker', ...input, now: this.now(),
        }));
    }
    async recordTurn(context, input) {
        this.requireSource(context, ['runtime']);
        await this.assertOwned(context);
        const current = await this.requireCurrent(context);
        const now = this.now();
        const next = reduceGoal(current.state, {
            type: 'record_turn', turnId: input.turnId, tokensUsed: input.tokensUsed,
            activeWallClockMs: input.activeWallClockMs, now,
        });
        const evidence = (input.evidence ?? []).map((record) => ({
            goalId: current.state.goalId,
            epoch: current.state.epoch,
            goalTurnId: input.turnId,
            evidenceId: `goal_ev_${randomUUID()}`,
            record,
            recordedAt: now,
        }));
        await this.options.store.commit({
            sessionId: context.sessionId,
            expectedRevision: current.state.revision,
            next,
            events: [this.event(next, context, 'turn_recorded')],
            turns: [{
                    goalId: current.state.goalId, epoch: current.state.epoch,
                    turnId: input.turnId, tokensUsed: input.tokensUsed,
                    activeWallClockMs: input.activeWallClockMs, recordedAt: now,
                }],
            evidence,
        });
        return next;
    }
    async settleTurn(context, input) {
        this.requireSource(context, ['runtime']);
        await this.assertOwned(context);
        const current = await this.requireCurrent(context);
        const now = this.now();
        const next = reduceGoal(current.state, {
            type: 'settle_turn', turnId: input.turnId, tokensUsed: input.tokensUsed,
            activeWallClockMs: input.activeWallClockMs,
            terminalDecision: input.terminalDecision, now,
        });
        const evidence = (input.evidence ?? []).map((record) => ({
            goalId: current.state.goalId,
            epoch: current.state.epoch,
            goalTurnId: input.turnId,
            evidenceId: `goal_ev_${randomUUID()}`,
            record,
            recordedAt: now,
        }));
        await this.options.store.commit({
            sessionId: context.sessionId,
            expectedRevision: current.state.revision,
            next,
            events: [this.event(next, context, 'turn_settled')],
            turns: [{
                    goalId: current.state.goalId, epoch: current.state.epoch,
                    turnId: input.turnId, tokensUsed: input.tokensUsed,
                    activeWallClockMs: input.activeWallClockMs, recordedAt: now,
                }],
            evidence,
        });
        return next;
    }
    async mutate(context, eventType, reducer) {
        await this.assertOwned(context);
        const current = await this.requireCurrent(context);
        const next = reducer(current.state);
        await this.options.store.commit({
            sessionId: context.sessionId,
            expectedRevision: current.state.revision,
            next,
            events: [this.event(next, context, eventType)],
            turns: [],
            evidence: [],
        });
        return next;
    }
    async requireCurrent(context) {
        const current = await this.options.store.load(context.sessionId);
        if (!current)
            throw new Error('Goal not found');
        if (current.state.revision !== context.expectedRevision) {
            throw new Error(`stale goal revision: expected ${context.expectedRevision}, found ${current.state.revision}`);
        }
        return current;
    }
    async assertOwned(context) {
        await this.options.ownership.assertOwned(context.sessionId, context.instanceId);
    }
    requireSource(context, allowed) {
        if (!allowed.includes(context.requestSource)) {
            throw new Error(`${context.requestSource} is not authorized for this Goal mutation`);
        }
    }
    event(state, context, type) {
        return {
            eventId: `goal_event_${randomUUID()}`,
            goalId: state.goalId,
            revision: state.revision,
            type,
            actor: context.requestSource,
            recordedAt: this.now(),
        };
    }
}
