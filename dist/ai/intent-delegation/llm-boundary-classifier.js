import { randomUUID } from 'node:crypto';
import { streamStatelessSideCallProviderConversation } from '../runtime/provider-conversation-authorization.js';
import { createLogger } from '../../utils/logger.js';
const log = createLogger('intent-boundary');
const INTENT_TYPES = new Set(['generate', 'revise', 'summarize', 'analyze']);
export function createAdapterBoundaryInvoker(adapter, config) {
    return {
        timeoutMs: config.timeoutMs,
        async invoke(prompt, signal) {
            const messages = [{
                    role: 'user',
                    content: [{ type: 'text', text: prompt }],
                }];
            let text = '';
            for await (const chunk of streamStatelessSideCallProviderConversation({
                adapter,
                messages,
                tools: [],
                systemPrompt: 'Return JSON only. Do not call tools.',
                invocationId: `inv_${randomUUID()}`,
                ...(signal ? { options: { signal } } : {}),
            })) {
                if (chunk.type === 'text')
                    text += chunk.delta;
                if (chunk.type === 'done')
                    break;
            }
            return text.trim();
        },
    };
}
export async function classifyBoundaryWithLlm(input, invoker) {
    const controller = new AbortController();
    const started = Date.now();
    log.info('intent_boundary_invoke_start', { sessionId: input.sessionId, timeoutMs: invoker.timeoutMs });
    try {
        const raw = await withTimeout(invoker.invoke(buildPrompt(input), controller.signal), invoker.timeoutMs, () => controller.abort());
        return parseDecision(raw);
    }
    catch {
        if (controller.signal.aborted)
            log.info('intent_boundary_timeout', { sessionId: input.sessionId, durationMs: Date.now() - started });
        return { kind: 'answer_directly', confidence: 0, reason: 'timeout_or_invoke_error' };
    }
    finally {
        log.info('intent_boundary_invoke_end', { sessionId: input.sessionId, durationMs: Date.now() - started, timedOut: controller.signal.aborted });
    }
}
function parseDecision(raw) {
    let value;
    try {
        value = JSON.parse(raw);
    }
    catch {
        return { kind: 'answer_directly', confidence: 0, reason: 'invalid_json' };
    }
    if (!isRecord(value) || 'stages' in value) {
        return { kind: 'answer_directly', confidence: 0, reason: 'schema_invalid' };
    }
    const kind = value.kind;
    const confidence = typeof value.confidence === 'number' ? value.confidence : -1;
    const reason = typeof value.reason === 'string' ? value.reason : '';
    if (confidence < 0 || confidence > 1 || !reason) {
        return { kind: 'answer_directly', confidence: 0, reason: 'schema_invalid' };
    }
    if (kind === 'answer_directly')
        return { kind, confidence, reason };
    if (kind === 'ask_clarification' && typeof value.question === 'string' && value.question.trim()) {
        return { kind, confidence, question: value.question.trim(), reason };
    }
    if (kind === 'create_intent'
        && typeof value.intentType === 'string'
        && INTENT_TYPES.has(value.intentType)
        && Array.isArray(value.deliverables)
        && value.deliverables.every((item) => typeof item === 'string')
        && Array.isArray(value.constraints)
        && value.constraints.every((item) => typeof item === 'string')) {
        return {
            kind,
            confidence,
            intentType: value.intentType,
            deliverables: value.deliverables,
            constraints: value.constraints,
            reason,
        };
    }
    return { kind: 'answer_directly', confidence: 0, reason: 'schema_invalid' };
}
function buildPrompt(input) {
    return [
        'Return JSON only.',
        'Decide whether this ambiguous user input should be answered directly, clarified, or turned into a workflow intent.',
        'Do not create stages. Do not include fields outside the schema.',
        `ambiguityType=${input.ruleDecision.ambiguityType}`,
        `input=${input.input}`,
    ].join('\n');
}
function withTimeout(promise, timeoutMs, onTimeout) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { onTimeout(); reject(new Error('timeout')); }, timeoutMs);
        promise.then((value) => {
            clearTimeout(timer);
            resolve(value);
        }, (error) => {
            clearTimeout(timer);
            reject(error);
        });
    });
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
