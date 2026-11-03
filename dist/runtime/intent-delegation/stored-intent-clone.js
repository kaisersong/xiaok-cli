// A data observation only: false is not proof of modern shape, authority or executable admission.
export function hasStoredReviewValue(ledger) {
    const records = [...ledger.intents, ...(ledger.latestPlan ? [ledger.latestPlan] : [])];
    return records.some(record => record.intentType === 'review'
        || record.steps.some(step => step.role === 'review')
        || record.stages?.some(stage => stage.intentType === 'review'
            || stage.steps.some(step => step.role === 'review')));
}
export function cloneIntentSteps(steps) {
    return steps.map((step) => ({ ...step, dependsOn: [...step.dependsOn] }));
}
function cloneStoredStages(stages, legacyRecord) {
    const effectiveStages = stages && stages.length > 0
        ? stages
        : [{
                stageId: `${legacyRecord.intentId}:stage:1`,
                order: 0,
                label: `生成${legacyRecord.deliverable}`,
                intentType: legacyRecord.intentType,
                deliverable: legacyRecord.deliverable,
                templateId: legacyRecord.templateId,
                riskTier: legacyRecord.riskTier,
                dependsOnStageIds: [],
                steps: legacyRecord.steps,
                status: 'planned',
                activeStepId: legacyRecord.activeStepId,
                structuralValidation: 'pending',
                semanticValidation: 'pending',
                needsFreshContextHandoff: false,
            }];
    return effectiveStages.map((stage) => ({
        ...stage,
        dependsOnStageIds: [...stage.dependsOnStageIds],
        steps: cloneIntentSteps(stage.steps),
    }));
}
export function cloneStoredIntentRecord(record) {
    const stages = cloneStoredStages(record.stages, {
        intentId: record.intentId,
        intentType: record.intentType,
        deliverable: record.finalDeliverable || record.deliverable,
        templateId: record.templateId,
        riskTier: record.riskTier,
        steps: record.steps,
        activeStepId: record.activeStepId,
    });
    const activeStageId = record.activeStageId ?? stages[0]?.stageId ?? `${record.intentId}:stage:1`;
    return {
        ...record,
        executionTerminals: record.executionTerminals?.map(terminal => ({ ...terminal })),
        providedSourcePaths: [...(record.providedSourcePaths ?? [])],
        explicitConstraints: [...record.explicitConstraints],
        delegationBoundary: [...record.delegationBoundary],
        finalDeliverable: record.finalDeliverable ?? record.deliverable,
        intentMode: record.intentMode ?? (stages.length > 1 ? 'multi_stage' : 'single_stage'),
        segmentationConfidence: record.segmentationConfidence ?? (stages.length > 1 ? 'medium' : 'low'),
        stages,
        activeStageId,
        artifacts: record.artifacts?.map(artifact => ({ ...artifact })),
        steps: cloneIntentSteps(record.steps),
        salvageSummary: record.salvageSummary ? [...record.salvageSummary] : undefined,
    };
}
export function cloneStoredSessionIntentLedger(ledger) {
    return {
        ...ledger,
        ...(ledger.verificationExecutions === undefined ? {} : { verificationExecutions: structuredClone(ledger.verificationExecutions) }),
        ...(ledger.publicationCandidates === undefined ? {} : { publicationCandidates: structuredClone(ledger.publicationCandidates) }),
        ...(ledger.nativeContracts === undefined ? {} : { nativeContracts: structuredClone(ledger.nativeContracts) }),
        latestPlan: ledger.latestPlan ? cloneStoredIntentRecord(ledger.latestPlan) : null,
        intents: ledger.intents.map(record => cloneStoredIntentRecord(record)),
        breadcrumbs: ledger.breadcrumbs.map(entry => ({ ...entry })),
        receipt: ledger.receipt ? { ...ledger.receipt } : null,
        salvage: ledger.salvage ? { ...ledger.salvage, summary: [...ledger.salvage.summary] } : null,
        ownership: { ...ledger.ownership },
    };
}
export function rekeyStoredSessionIntentLedger(ledger, sessionId) {
    const cloned = cloneStoredSessionIntentLedger(ledger);
    return {
        ...cloned,
        sessionId,
        latestPlan: cloned.latestPlan ? { ...cloned.latestPlan, sessionId } : null,
        intents: cloned.intents.map(intent => ({ ...intent, sessionId })),
    };
}
