export function createEmptySessionSkillEvalState(now = Date.now()) {
    return {
        observations: [],
        feedback: [],
        promptedIntentIds: [],
        updatedAt: now,
    };
}
export function cloneSessionSkillEvalState(state) {
    return {
        observations: state.observations.map(cloneObservation),
        feedback: state.feedback.map((record) => ({
            ...record,
            observationIds: [...record.observationIds],
        })),
        promptedIntentIds: [...state.promptedIntentIds],
        updatedAt: state.updatedAt,
    };
}
export function cloneContextualSkillScoreRecord(record) {
    return {
        ...record,
        runtimeSuccessObservationIds: [...record.runtimeSuccessObservationIds],
        runtimeFailureObservationIds: [...record.runtimeFailureObservationIds],
        routingPositiveFeedbackIds: [...record.routingPositiveFeedbackIds],
        routingNegativeFeedbackIds: [...record.routingNegativeFeedbackIds],
        outcomePositiveFeedbackIds: [...record.outcomePositiveFeedbackIds],
        outcomeNegativeFeedbackIds: [...record.outcomeNegativeFeedbackIds],
    };
}
export function buildSkillScoreKey(input) {
    return [
        input.skillName,
        input.intentType,
        input.stageRole,
        input.deliverableFamily,
    ].join('::');
}
export function inferDeliverableFamily(value) {
    if (!value)
        return 'unknown';
    if (/(md|markdown)/iu.test(value))
        return 'markdown';
    if (/(ppt|幻灯片|deck|slides)/iu.test(value))
        return 'slides';
    if (/(总结|摘要|纪要|结论)/u.test(value))
        return 'summary';
    if (/(测算|分析|判断|评估|报价)/u.test(value))
        return 'analysis';
    if (/(表格|清单|表|csv|sheet)/iu.test(value))
        return 'table';
    if (/(方案|报告|提纲|文案|稿|说明|proposal|report|brief|document)/iu.test(value))
        return 'document';
    return 'unknown';
}
export function computeContextualSkillBoost(record) {
    if (!record) {
        return 0;
    }
    const runtimeDelta = clamp(record.runtimeSuccessObservationIds.length - record.runtimeFailureObservationIds.length, -3, 3) * 0.4;
    const routingDelta = clamp(record.routingPositiveFeedbackIds.length - record.routingNegativeFeedbackIds.length, -3, 3) * 1.0;
    const outcomeDelta = clamp(record.outcomePositiveFeedbackIds.length - record.outcomeNegativeFeedbackIds.length, -3, 3) * 0.3;
    const evidenceCount = (record.runtimeSuccessObservationIds.length
        + record.runtimeFailureObservationIds.length
        + record.routingPositiveFeedbackIds.length
        + record.routingNegativeFeedbackIds.length
        + record.outcomePositiveFeedbackIds.length
        + record.outcomeNegativeFeedbackIds.length);
    const confidence = Math.min(1, evidenceCount / 4);
    return clamp((runtimeDelta + routingDelta + outcomeDelta) * confidence, -3, 3);
}
function cloneObservation(record) {
    return {
        ...record,
    };
}
function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}
