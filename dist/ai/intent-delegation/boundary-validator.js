import { createIntentPlan } from './planner.js';
const SUPPORTED_INTENT_TYPES = new Set(['generate', 'revise', 'summarize', 'analyze']);
const VAGUE_DELIVERABLE_TERMS = new Set([
    '交付物',
    '交付',
    '产出物',
    '产物',
    '结果',
    '分析结果',
    '总结结果',
    'output',
    'deliverable',
]);
export function validateBoundaryDecision(input, candidate, options = {}) {
    const confidenceThreshold = options.confidenceThreshold ?? 0.75;
    const falseNegativeClarifyThreshold = options.falseNegativeClarifyThreshold ?? 0.85;
    if (candidate.decision.kind === 'answer_directly') {
        if (candidate.ruleDecision?.kind === 'ambiguous'
            && candidate.ruleDecision.plannerHint?.prefersIntent
            && candidate.decision.confidence < falseNegativeClarifyThreshold) {
            return {
                kind: 'clarify',
                question: '你希望我直接分析回答，还是生成一个具体交付物？',
                reason: 'low_confidence_false_negative_guard',
                source: candidate.source,
            };
        }
        return { kind: 'non_intent', reason: candidate.decision.reason, source: candidate.source };
    }
    if (candidate.decision.kind === 'create_intent'
        && candidate.decision.confidence < confidenceThreshold) {
        if (candidate.ruleDecision?.kind === 'ambiguous' && candidate.ruleDecision.plannerHint?.prefersIntent) {
            return {
                kind: 'clarify',
                question: '你希望我直接分析回答，还是生成一个具体交付物？',
                reason: 'low_confidence_create_intent_guard',
                source: candidate.source,
            };
        }
        return { kind: 'non_intent', reason: 'low_confidence_create_intent', source: candidate.source };
    }
    if (candidate.decision.kind === 'ask_clarification') {
        return {
            kind: 'clarify',
            question: candidate.decision.question,
            reason: candidate.decision.reason,
            source: candidate.source,
        };
    }
    const deliverables = candidate.decision.kind === 'create_intent'
        ? candidate.decision.deliverables
        : candidate.ruleDecision?.kind !== 'definite_non_intent'
            ? candidate.ruleDecision?.plannerHint?.deliverables ?? []
            : [];
    const intentType = candidate.decision.kind === 'create_intent'
        ? candidate.decision.intentType
        : candidate.ruleDecision?.kind !== 'definite_non_intent'
            ? candidate.ruleDecision?.plannerHint?.intentType
            : undefined;
    if (!isSupportedIntentType(intentType)) {
        return { kind: 'non_intent', reason: 'unsupported_intent_type', source: candidate.source };
    }
    const concreteDeliverables = deliverables.filter(isConcreteDeliverable);
    if (concreteDeliverables.length === 0 && !input.activeIntent) {
        return { kind: 'non_intent', reason: 'missing_concrete_deliverable', source: candidate.source };
    }
    const plannerInput = concreteDeliverables.length > 0
        ? `${input.input}，${buildDeliverableInstruction(intentType, concreteDeliverables)}`
        : input.input;
    const planResult = createIntentPlan({
        instanceId: input.instanceId,
        sessionId: input.sessionId,
        input: plannerInput,
        skills: input.skills,
        activeIntent: input.activeIntent,
        skillScoreLookup: input.skillScoreLookup,
    });
    if (planResult.kind !== 'plan'
        || planResult.plan.deliverable === '交付物'
        || planResult.plan.finalDeliverable === '交付物') {
        return { kind: 'non_intent', reason: 'planner_rejected_after_validation', source: candidate.source };
    }
    return { kind: 'intent', plan: planResult.plan, source: candidate.source };
}
function isSupportedIntentType(value) {
    return typeof value === 'string' && SUPPORTED_INTENT_TYPES.has(value);
}
function isConcreteDeliverable(value) {
    const normalized = value.trim().toLowerCase();
    if (!normalized || VAGUE_DELIVERABLE_TERMS.has(normalized))
        return false;
    return /(报告|幻灯片|ppt|slides|文档|表格|清单|方案|备忘录|memo|markdown|md|代码|测试|summary|report|deck)/iu.test(normalized);
}
function buildDeliverableInstruction(intentType, deliverables) {
    const verb = intentType === 'summarize'
        ? '总结成'
        : intentType === 'revise'
            ? '修改成'
            : intentType === 'analyze'
                ? '分析成'
                : '生成';
    return deliverables.map((deliverable, index) => `${index === 0 ? verb : `然后${verb}`}${deliverable}`).join('，');
}
