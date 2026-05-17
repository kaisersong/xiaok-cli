import { classifyIntentBoundaryByRules } from './boundary-classifier.js';
import { validateBoundaryDecision } from './boundary-validator.js';
export function createIntentBoundaryResolver(options) {
    let clarificationCount = 0;
    async function resolve(input) {
        const ruleDecision = classifyIntentBoundaryByRules(input);
        if (ruleDecision.kind === 'definite_non_intent') {
            const result = { kind: 'non_intent', reason: ruleDecision.reason, source: 'rule' };
            emit(options, result, ruleDecision.reason);
            return result;
        }
        if (ruleDecision.kind === 'definite_intent') {
            const result = validateBoundaryDecision(input, {
                source: 'rule',
                ruleDecision,
                decision: { kind: 'rule_intent', reason: ruleDecision.reason },
            }, options.config);
            return applyClarificationLimit(result);
        }
        const legacy = validateBoundaryDecision(input, {
            source: 'compat_legacy',
            ruleDecision,
            decision: { kind: 'rule_intent', reason: 'legacy_validator' },
        }, options.config);
        if (options.config.llmClassifier === 'off') {
            return applyClarificationLimit(resolveFallback(options.config, legacy, ruleDecision));
        }
        const llmDecision = await options.llmClassify?.(input, ruleDecision);
        if (!llmDecision) {
            return applyClarificationLimit(resolveFallback(options.config, legacy, ruleDecision));
        }
        if (options.config.llmClassifier === 'shadow') {
            options.emitDebug?.({
                type: 'intent_boundary_decision',
                source: 'llm',
                decision: legacy.kind,
                reason: 'shadow',
                ambiguityType: ruleDecision.ambiguityType,
                confidence: 'confidence' in llmDecision ? llmDecision.confidence : undefined,
                shadowDecision: llmDecision.kind,
                divergence: legacy.kind !== mapLlmKind(llmDecision.kind),
            });
            return applyClarificationLimit(resolveFallback(options.config, legacy, ruleDecision));
        }
        const active = validateBoundaryDecision(input, { source: 'llm', ruleDecision, decision: llmDecision }, options.config);
        return applyClarificationLimit(active);
    }
    function applyClarificationLimit(result) {
        if (result.kind !== 'clarify') {
            clarificationCount = 0;
            return result;
        }
        clarificationCount += 1;
        if (clarificationCount > 2) {
            return { kind: 'non_intent', reason: 'clarification_limit_reached', source: result.source };
        }
        return result;
    }
    return { resolve };
}
function resolveFallback(config, legacy, ruleDecision) {
    if (config.ambiguousFallback === 'answer_directly') {
        return { kind: 'non_intent', reason: 'ambiguous_answer_directly', source: 'compat_legacy' };
    }
    if (config.ambiguousFallback === 'ask_clarification') {
        return {
            kind: 'clarify',
            question: '你希望我直接分析回答，还是生成一个具体交付物？',
            reason: 'ambiguous_configured_clarification',
            source: 'compat_legacy',
        };
    }
    if (legacy.kind === 'intent')
        return legacy;
    if (ruleDecision.plannerHint?.prefersIntent) {
        return {
            kind: 'clarify',
            question: '你希望我直接分析回答，还是生成一个具体交付物？',
            reason: 'ambiguous_prefers_intent',
            source: 'compat_legacy',
        };
    }
    return legacy;
}
function emit(options, result, reason) {
    options.emitDebug?.({
        type: 'intent_boundary_decision',
        source: result.source,
        decision: result.kind,
        reason,
    });
}
function mapLlmKind(kind) {
    if (kind === 'create_intent')
        return 'intent';
    if (kind === 'ask_clarification')
        return 'clarify';
    return 'non_intent';
}
