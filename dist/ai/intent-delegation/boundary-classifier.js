import { createIntentPlan } from './planner.js';
const EXPLICIT_DELIVERABLE_PATTERN = /(报告|幻灯片|ppt|slides|文档|表格|清单|方案|备忘录|memo|markdown|md|代码|改代码|补测试)/iu;
const VERB_NO_OUTPUT_PATTERN = /^(?:帮我|请|麻烦)?\s*(?:分析|研究|看看|判断)(?:一下)?(?:这个|这件事|这个方向|这个问题)?\s*$/u;
const MATERIAL_NO_DIRECTIVE_PATTERN = /(基于|根据|结合).*(这些|这个|内容|材料|文档).*(看看|分析|研究)(有什么|一下)?/u;
export function classifyIntentBoundaryByRules(input) {
    if (MATERIAL_NO_DIRECTIVE_PATTERN.test(input.input)) {
        return { kind: 'ambiguous', ambiguityType: 'material_no_directive', reason: 'material_without_output' };
    }
    if (VERB_NO_OUTPUT_PATTERN.test(input.input)) {
        return { kind: 'ambiguous', ambiguityType: 'verb_no_output', reason: 'verb_without_output' };
    }
    const planResult = createIntentPlan({
        instanceId: input.instanceId,
        sessionId: input.sessionId,
        input: input.input,
        skills: input.skills,
        activeIntent: input.activeIntent,
        skillScoreLookup: input.skillScoreLookup,
    });
    if (planResult.kind === 'non_intent') {
        return { kind: 'definite_non_intent', reason: planResult.reason };
    }
    const plan = planResult.plan;
    const deliverables = splitDeliverables(plan.deliverable);
    const hint = {
        intentType: plan.intentType,
        deliverables,
        providedSourcePaths: plan.providedSourcePaths ?? [],
        prefersIntent: true,
        reason: `planner:${plan.templateId}`,
    };
    if (plan.continuationMode === 'continue_active' || plan.continuationMode === 'clarify') {
        return { kind: 'definite_intent', reason: plan.continuationMode, plannerHint: hint };
    }
    if (plan.deliverable === '交付物' || plan.finalDeliverable === '交付物') {
        return { kind: 'definite_non_intent', reason: 'default_deliverable', plannerHint: hint };
    }
    if (EXPLICIT_DELIVERABLE_PATTERN.test(plan.deliverable) || EXPLICIT_DELIVERABLE_PATTERN.test(input.input)) {
        return { kind: 'definite_intent', reason: 'explicit_deliverable', plannerHint: hint };
    }
    return {
        kind: 'ambiguous',
        ambiguityType: 'implicit_workflow',
        reason: 'planner_concrete_but_not_explicit',
        plannerHint: hint,
    };
}
function splitDeliverables(value) {
    return value.split(/\s*->\s*|[、,，和]/u).map((item) => item.trim()).filter(Boolean);
}
