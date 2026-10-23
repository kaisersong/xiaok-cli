import { brandObservationDelegationTool, isObservationDelegationTool } from './delegation-tool-brand.js';
import { randomUUID } from 'node:crypto';
import { AgentSessionState } from '../../ai/runtime/session.js';
import { executeNamedSubAgent } from '../../ai/agents/subagent-executor.js';
import { getObservationSessionOwnerHostBinding } from './observation-session-owner.js';
import { createTransportAuthorizationError } from './transport-lease.js';
const getParentSession = (owner) => getObservationSessionOwnerHostBinding(owner).session;
const compoundAdapters = new WeakMap();
export function getProductObservationDelegationAdapter(tool) {
    return isObservationDelegationTool(tool) ? compoundAdapters.get(tool) : undefined;
}
/** Explicit product consent supplies authority; model arguments supply only the task text. */
export function createProductObservationSubagentTool(options) {
    return createBoundTool(options, () => options.parentOwner);
}
function createBoundTool(options, parent) {
    const policy = options.product.summary.ordinaryChildren;
    if (!policy)
        throw createTransportAuthorizationError();
    const depth = options.depth ?? 0;
    const allocations = new WeakMap();
    const armed = new Map();
    const validate = (input) => {
        if (Object.keys(input).some(key => key !== 'prompt') || typeof input.prompt !== 'string' || !input.prompt.trim() || Buffer.byteLength(input.prompt) > 65536 || depth >= policy.maxDepth || options.product.getStatus().revoked)
            throw createTransportAuthorizationError();
    };
    const key = (context) => {
        if (!context.hostProviderInvocationId || !context.toolInvocationId)
            throw Error('compound_child_admission_required');
        return JSON.stringify([context.session.sessionId, context.hostProviderInvocationId, context.toolInvocationId]);
    };
    const port = Object.freeze({
        allocate(input) {
            validate(input);
            const parentOwner = parent();
            parentOwner.assertSession(getParentSession(parentOwner));
            const session = new AgentSessionState();
            session.restoreSnapshot({ ...session.exportSnapshot(), sessionId: randomUUID(), cwd: options.cwd });
            const allocation = Object.freeze({ opaqueProductChildAllocation: true });
            allocations.set(allocation, { session, parentOwner, prompt: input.prompt, state: 'allocated' });
            return allocation;
        },
        getSession(allocation) { const entry = allocations.get(allocation); if (!entry || entry.state === 'closed')
            throw Error('compound_child_allocation_invalid'); return entry.session; },
        getOutcome(allocation) { const entry = allocations.get(allocation); if (!entry)
            throw Error('compound_child_allocation_invalid'); return entry.outcome ?? (entry.state === 'running' ? 'running' : 'not_started'); },
        arm(allocation, context, installer) { const entry = allocations.get(allocation), id = key(context); if (!entry || entry.state !== 'allocated' || typeof installer !== 'function' || armed.has(id) || context.session.sessionId !== getParentSession(entry.parentOwner).exportSnapshot().sessionId)
            throw Error('compound_child_allocation_invalid'); entry.state = 'armed'; entry.installer = installer; armed.set(id, allocation); },
        discard(allocation) { const entry = allocations.get(allocation); if (!entry || !['allocated', 'armed'].includes(entry.state))
            throw Error('compound_child_allocation_invalid'); for (const [key, value] of armed)
            if (value === allocation)
                armed.delete(key); entry.state = 'closed'; },
    });
    const tool = brandObservationDelegationTool({
        definition: { name: 'subagent', description: '执行已获用户授权的普通子任务，只能使用固定本地工具和当前模型；严禁自行扩大工具、材料、模型或授权期限。',
            inputSchema: { type: 'object', properties: { prompt: { type: 'string', description: '子任务要求' } }, required: ['prompt'], additionalProperties: false } },
        permission: 'safe',
        async execute(input, context) {
            validate(input);
            let entry;
            if (options.product.summary.compoundExecution) {
                if (!context)
                    throw Error('compound_child_admission_required');
                const id = key(context), allocation = armed.get(id);
                entry = allocation ? allocations.get(allocation) : undefined;
                if (!entry || entry.state !== 'armed' || entry.prompt !== input.prompt)
                    throw Error('compound_child_admission_required');
                armed.delete(id);
                entry.state = 'running';
            }
            else {
                const allocation = port.allocate(input);
                entry = allocations.get(allocation);
                entry.state = 'running';
            }
            const session = entry.session, sessionId = session.exportSnapshot().sessionId;
            try {
                const plan = options.product.createChildExecutionPlan({ parentOwner: entry.parentOwner, session, persist: options.persist, installChildExecution: entry.installer });
                let childOwner;
                const result = await executeNamedSubAgent({ observationExecutionPlan: plan, sessionId, cwd: options.cwd,
                    agentDef: { name: 'observation-child', systemPrompt: '完成当前子任务，遵守固定授权范围。', allowedTools: [...policy.nativeTools], isolation: 'shared' },
                    prompt: entry.prompt, adapter: options.adapter, buildSystemPrompt: options.buildSystemPrompt,
                    signal: context?.signal, parentDepth: depth + 1, onCompleted: options.onCompleted,
                    onObservationOwnerReady: owner => { childOwner = owner; },
                    createRegistry() {
                        const registry = options.product.summary.compoundExecution
                            ? options.sourceRegistry.forkForCompoundObservation([], [...policy.nativeTools])
                            : options.sourceRegistry.forkForObservation([], [...policy.nativeTools]);
                        if (depth + 1 < policy.maxDepth) {
                            const nested = createBoundTool({ ...options, depth: depth + 1 }, () => { if (!childOwner)
                                throw createTransportAuthorizationError(); return childOwner; });
                            registry.registerTool(nested);
                        }
                        return registry;
                    },
                    releaseRegistry: registry => registry.dispose(),
                });
                entry.outcome = 'completed';
                return result;
            }
            catch (error) {
                entry.outcome = 'failed';
                throw error;
            }
        },
    });
    if (options.product.summary.compoundExecution)
        compoundAdapters.set(tool, port);
    return tool;
}
