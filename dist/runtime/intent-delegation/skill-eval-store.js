import { AsyncLocalStorage } from 'node:async_hooks';
import { createEmptySessionSkillEvalState, cloneSessionSkillEvalState, inferDeliverableFamily, } from './skill-eval.js';
export class SessionSkillEvalStore {
    sessionStore;
    scope = new AsyncLocalStorage();
    tail = Promise.resolve();
    mutationPort;
    constructor(sessionStore, options) {
        this.sessionStore = sessionStore;
        this.mutationPort = options?.withMutationLease;
    }
    /** Fixed host composition. No lease or write token is exposed to hook callers. */
    withMutation(sessionId, work) {
        const inherited = this.scope.getStore();
        if (inherited) {
            this.assertMutationCurrent(sessionId);
            return Promise.resolve().then(work);
        }
        const run = async (lease) => { lease?.assertCurrent(); const context = { sessionId, lease, active: true }; try {
            return await this.scope.run(context, work);
        }
        finally {
            context.active = false;
        } };
        const pending = this.tail.then(() => this.mutationPort ? this.mutationPort(sessionId, lease => run(lease)) : run());
        this.tail = pending.then(() => { }, () => { });
        return pending;
    }
    assertMutationCurrent(sessionId) { const scope = this.scope.getStore(); if (!scope?.active || scope.sessionId !== sessionId)
        throw Error('skill_eval_mutation_scope'); scope.lease?.assertCurrent(); }
    async load(sessionId) {
        const snapshot = await this.sessionStore.load(sessionId);
        if (!snapshot) {
            return null;
        }
        return snapshot.skillEval ? cloneSessionSkillEvalState(snapshot.skillEval) : createEmptySessionSkillEvalState(snapshot.updatedAt);
    }
    async ensureObservationsForIntent(sessionId, intent) {
        return this.mutate(sessionId, (state) => ensureObservationsForIntentState(state, intent));
    }
    async recordSkillInvocation(sessionId, input) {
        return this.mutate(sessionId, (state) => {
            const next = cloneSessionSkillEvalState(state);
            const now = input.now ?? Date.now();
            const matchingObservations = next.observations.filter((observation) => (observation.intentId === input.intentId && observation.stepId === input.stepId));
            if (matchingObservations.length === 0 && input.intent) {
                const stepContext = findIntentStepContext(input.intent, input.stepId);
                if (stepContext) {
                    assertSkillEvalText(stepContext.stage.stageId, 'skill_eval_stage_id_data');
                    assertSkillEvalText(stepContext.step.stepId, 'skill_eval_step_id_data');
                    assertSkillEvalIntentType(input.intent.intentType);
                    assertSkillEvalRole(stepContext.step.role);
                    assertSkillEvalText(stepContext.stage.deliverable, 'skill_eval_deliverable_data');
                    next.observations.push({
                        observationId: `${input.stepId}:skill_eval`,
                        sessionId: input.intent.sessionId,
                        intentId: input.intent.intentId,
                        stageId: stepContext.stage.stageId,
                        stepId: stepContext.step.stepId,
                        intentType: input.intent.intentType,
                        stageRole: stepContext.step.role,
                        deliverable: stepContext.stage.deliverable,
                        deliverableFamily: inferDeliverableFamily(stepContext.stage.deliverable),
                        selectedSkillName: (isDedicatedSkillName(stepContext.step.skillName)
                            ? stepContext.step.skillName
                            : input.skillName),
                        actualSkillName: input.skillName,
                        status: mapStepStatus(stepContext.step.status),
                        artifactRecorded: false,
                        createdAt: now,
                        updatedAt: now,
                    });
                }
            }
            for (const observation of next.observations) {
                if (observation.intentId === input.intentId && observation.stepId === input.stepId) {
                    observation.actualSkillName = input.skillName;
                    observation.updatedAt = now;
                }
            }
            next.updatedAt = now;
            return next;
        });
    }
    async updateObservationStatus(sessionId, input) {
        return this.mutate(sessionId, (state) => {
            const next = cloneSessionSkillEvalState(state);
            for (const observation of next.observations) {
                if (observation.intentId === input.intentId && observation.stepId === input.stepId) {
                    observation.status = input.status;
                    observation.updatedAt = input.now ?? Date.now();
                }
            }
            next.updatedAt = input.now ?? Date.now();
            return next;
        });
    }
    async recordArtifact(sessionId, input) {
        return this.mutate(sessionId, (state) => {
            const next = cloneSessionSkillEvalState(state);
            for (const observation of next.observations) {
                if (observation.intentId === input.intentId && observation.stageId === input.stageId) {
                    observation.artifactRecorded = true;
                    observation.structuralValidation = input.structuralValidation;
                    observation.semanticValidation = input.semanticValidation;
                    observation.updatedAt = input.now ?? Date.now();
                }
            }
            next.updatedAt = input.now ?? Date.now();
            return next;
        });
    }
    async markPromptedIntent(sessionId, intentId, now = Date.now()) {
        return this.mutate(sessionId, (state) => {
            const next = cloneSessionSkillEvalState(state);
            if (!next.promptedIntentIds.includes(intentId)) {
                next.promptedIntentIds.push(intentId);
            }
            next.updatedAt = now;
            return next;
        });
    }
    async recordFeedback(sessionId, feedback) {
        return this.mutate(sessionId, (state) => {
            const next = cloneSessionSkillEvalState(state);
            next.feedback.push({
                ...feedback,
                observationIds: [...feedback.observationIds],
            });
            next.updatedAt = feedback.createdAt;
            return next;
        });
    }
    async mutate(sessionId, apply) {
        return this.withMutation(sessionId, async () => {
            this.assertMutationCurrent(sessionId);
            const snapshot = await this.requireSnapshot(sessionId);
            this.assertMutationCurrent(sessionId);
            const current = snapshot.skillEval ? cloneSessionSkillEvalState(snapshot.skillEval) : createEmptySessionSkillEvalState(snapshot.updatedAt), next = apply(current);
            const nextSnapshot = { ...snapshot, updatedAt: Math.max(snapshot.updatedAt, next.updatedAt), skillEval: cloneSessionSkillEvalState(next) }, lease = this.scope.getStore().lease;
            this.assertMutationCurrent(sessionId);
            if (lease) {
                if (!this.sessionStore.compareAndSave || snapshot.storeRevision === undefined || snapshot.historyDigest === undefined)
                    throw Error('skill_eval_cas_required');
                await this.sessionStore.compareAndSave({ nextSnapshot, expectedStoreRevision: snapshot.storeRevision, expectedHistoryDigest: snapshot.historyDigest, lease });
            }
            else
                await this.sessionStore.save(nextSnapshot);
            this.assertMutationCurrent(sessionId);
            return next;
        });
    }
    async requireSnapshot(sessionId) {
        const snapshot = await this.sessionStore.load(sessionId);
        if (!snapshot) {
            throw new Error(`session not found: ${sessionId}`);
        }
        return snapshot;
    }
}
export function ensureObservationsForIntentState(state, intent, now = Date.now()) {
    const next = cloneSessionSkillEvalState(state);
    for (const stage of skillEvalStages(intent.stages)) {
        for (const step of skillEvalSteps(stage.steps)) {
            if (!isDedicatedSkillName(step.skillName)) {
                continue;
            }
            const existing = next.observations.find((observation) => observation.stepId === step.stepId);
            if (existing) {
                continue;
            }
            assertSkillEvalText(stage.stageId, 'skill_eval_stage_id_data');
            assertSkillEvalText(step.stepId, 'skill_eval_step_id_data');
            assertSkillEvalIntentType(intent.intentType);
            assertSkillEvalRole(step.role);
            assertSkillEvalText(stage.deliverable, 'skill_eval_deliverable_data');
            next.observations.push({
                observationId: `${step.stepId}:skill_eval`,
                sessionId: intent.sessionId,
                intentId: intent.intentId,
                stageId: stage.stageId,
                stepId: step.stepId,
                intentType: intent.intentType,
                stageRole: step.role,
                deliverable: stage.deliverable,
                deliverableFamily: inferDeliverableFamily(stage.deliverable),
                selectedSkillName: step.skillName,
                status: step.status === 'planned' ? 'planned' : mapStepStatus(step.status),
                artifactRecorded: false,
                createdAt: now,
                updatedAt: now,
            });
        }
    }
    next.updatedAt = now;
    return next;
}
function skillEvalStages(value) {
    if (!Array.isArray(value))
        throw Error('skill_eval_stages_data');
    return value;
}
function skillEvalSteps(value) {
    if (!Array.isArray(value))
        throw Error('skill_eval_steps_data');
    return value;
}
function assertSkillEvalText(value, error) {
    if (typeof value !== 'string')
        throw Error(error);
}
function assertSkillEvalIntentType(value) {
    if (value !== 'generate' && value !== 'revise' && value !== 'summarize' && value !== 'analyze')
        throw Error('skill_eval_intent_type_data');
}
function assertSkillEvalRole(value) {
    if (value !== 'collect' && value !== 'inspect_current' && value !== 'normalize' && value !== 'identify_delta' && value !== 'extract' && value !== 'compare' && value !== 'compose' && value !== 'rewrite' && value !== 'structure' && value !== 'conclude' && value !== 'validate' && value !== 'finalize')
        throw Error('skill_eval_role_data');
}
function isDedicatedSkillName(value) {
    if (!value)
        return false;
    if (typeof value !== 'string')
        throw Error('skill_eval_skill_name_data');
    return !value.startsWith('generic_llm::');
}
function mapStepStatus(status) {
    if (status === 'completed')
        return 'completed';
    if (status === 'failed')
        return 'failed';
    if (status === 'blocked')
        return 'blocked';
    if (status === 'running')
        return 'running';
    if (status === 'planned' || status === 'skipped')
        return 'planned';
    throw Error('skill_eval_status_data');
}
function findIntentStepContext(intent, stepId) {
    for (const stage of skillEvalStages(intent.stages)) {
        const step = skillEvalSteps(stage.steps).find((candidate) => candidate.stepId === stepId);
        if (step) {
            return { stage, step };
        }
    }
    return undefined;
}
