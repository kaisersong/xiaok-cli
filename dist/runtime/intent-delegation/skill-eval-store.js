import { createEmptySessionSkillEvalState, cloneSessionSkillEvalState, inferDeliverableFamily, } from './skill-eval.js';
export class SessionSkillEvalStore {
    sessionStore;
    constructor(sessionStore) {
        this.sessionStore = sessionStore;
    }
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
                        selectedSkillName: (stepContext.step.skillName && !stepContext.step.skillName.startsWith('generic_llm::')
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
        const snapshot = await this.requireSnapshot(sessionId);
        const current = snapshot.skillEval ? cloneSessionSkillEvalState(snapshot.skillEval) : createEmptySessionSkillEvalState(snapshot.updatedAt);
        const next = apply(current);
        await this.sessionStore.save({
            ...snapshot,
            updatedAt: next.updatedAt,
            skillEval: cloneSessionSkillEvalState(next),
        });
        return next;
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
    for (const stage of intent.stages) {
        for (const step of stage.steps) {
            if (!step.skillName || step.skillName.startsWith('generic_llm::')) {
                continue;
            }
            const existing = next.observations.find((observation) => observation.stepId === step.stepId);
            if (existing) {
                continue;
            }
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
function mapStepStatus(status) {
    if (status === 'completed')
        return 'completed';
    if (status === 'failed')
        return 'failed';
    if (status === 'blocked')
        return 'blocked';
    if (status === 'running')
        return 'running';
    return 'planned';
}
function findIntentStepContext(intent, stepId) {
    for (const stage of intent.stages) {
        const step = stage.steps.find((candidate) => candidate.stepId === stepId);
        if (step) {
            return { stage, step };
        }
    }
    return undefined;
}
