import { cloneIntentSteps as cloneSteps, cloneStoredIntentRecord, cloneStoredSessionIntentLedger, rekeyStoredSessionIntentLedger } from './stored-intent-clone.js';
export function createIntentLedgerRecord(plan, now = Date.now()) {
    const stages = cloneStageDrafts(plan.stages, plan);
    const activeStage = stages[0];
    const steps = activeStage ? cloneSteps(activeStage.steps) : cloneSteps(plan.steps);
    const record = {
        intentId: plan.intentId,
        instanceId: plan.instanceId,
        sessionId: plan.sessionId,
        rawIntent: plan.rawIntent,
        normalizedIntent: plan.normalizedIntent,
        providedSourcePaths: [...(plan.providedSourcePaths ?? [])],
        intentType: plan.intentType,
        deliverable: plan.deliverable,
        finalDeliverable: plan.finalDeliverable,
        explicitConstraints: [...plan.explicitConstraints],
        delegationBoundary: [...plan.delegationBoundary],
        riskTier: plan.riskTier,
        intentMode: plan.intentMode,
        segmentationConfidence: plan.segmentationConfidence,
        templateId: plan.templateId,
        stages,
        activeStageId: activeStage?.stageId ?? `${plan.intentId}:stage:unknown`,
        artifacts: [],
        steps,
        activeStepId: activeStage?.activeStepId ?? steps[0]?.stepId ?? `${plan.intentId}:step:unknown`,
        overallStatus: 'drafting_plan',
        attemptCount: 1,
        createdAt: now,
        updatedAt: now,
    };
    const normalized = cloneIntentRecord(record);
    return {
        ...record,
        finalDeliverable: normalized.finalDeliverable,
        intentMode: normalized.intentMode,
        segmentationConfidence: normalized.segmentationConfidence,
    };
}
export function cloneIntentRecord(record) {
    return cloneStoredIntentRecord(record);
}
export function cloneSessionIntentLedger(ledger) {
    return cloneStoredSessionIntentLedger(ledger);
}
export function rekeySessionIntentLedger(ledger, sessionId) {
    return rekeyStoredSessionIntentLedger(ledger, sessionId);
}
export function createEmptySessionIntentLedger(sessionId, now = Date.now()) {
    return {
        sessionId,
        activeIntentId: undefined,
        latestPlan: null,
        intents: [],
        breadcrumbs: [],
        receipt: null,
        salvage: null,
        ownership: {
            state: 'released',
            updatedAt: now,
        },
        updatedAt: now,
    };
}
export function resolveActiveRiskTier(ledger) {
    const activeIntent = ledger.activeIntentId
        ? ledger.intents.find((intent) => intent.intentId === ledger.activeIntentId)
        : undefined;
    if (!activeIntent) {
        return null;
    }
    const activeStage = activeIntent.stages.find((stage) => stage.stageId === activeIntent.activeStageId);
    const activeStep = activeIntent.steps.find((step) => step.stepId === activeIntent.activeStepId)
        ?? activeStage?.steps.find((step) => step.stepId === activeIntent.activeStepId);
    return activeStep?.riskTier ?? activeStage?.riskTier ?? activeIntent.riskTier;
}
function cloneStageDrafts(stages, legacyPlan) {
    const effectiveStages = stages && stages.length > 0
        ? stages
        : legacyPlan
            ? [{
                    stageId: `${legacyPlan.intentId}:stage:1`,
                    order: 0,
                    label: `生成${legacyPlan.deliverable}`,
                    intentType: legacyPlan.intentType,
                    deliverable: legacyPlan.deliverable,
                    templateId: legacyPlan.templateId,
                    riskTier: legacyPlan.riskTier,
                    dependsOnStageIds: [],
                    steps: legacyPlan.steps,
                }]
            : [];
    return effectiveStages.map((stage) => ({
        ...stage,
        dependsOnStageIds: [...stage.dependsOnStageIds],
        steps: cloneSteps(stage.steps),
        status: 'planned',
        activeStepId: stage.steps[0]?.stepId ?? `${stage.stageId}:step:unknown`,
        structuralValidation: 'pending',
        semanticValidation: 'pending',
        needsFreshContextHandoff: stage.order > 0,
    }));
}
