import { Agent } from '../agent.js';
import { buildSynthesizedProviderContext, isStrictKimiK3Adapter, } from '../runtime/provider-private-projection.js';
export async function executeNamedSubAgent(options) {
    const resolved = await resolveSubAgentCwd(options.worktreeManager, options.agentDef, options.sessionId, options.cwd);
    const cwd = resolved.cwd;
    const registry = options.createRegistry(cwd, options.agentDef.allowedTools, options.agentDef.name, { parentDepth: options.parentDepth });
    const systemPromptBase = await options.buildSystemPrompt(cwd);
    const systemPrompt = [systemPromptBase, options.agentDef.systemPrompt].filter(Boolean).join('\n\n');
    const baseAdapter = options.adapter();
    const strictK3Parent = isStrictKimiK3Adapter(baseAdapter);
    const adapter = resolveSubAgentAdapter(baseAdapter, options.agentDef.model, options.agentDef.modelCapability, options.forkContext);
    const agent = new Agent(adapter, registry, systemPrompt, {
        maxIterations: options.agentDef.maxIterations,
        providerSurfaceKind: 'cli-subagent',
    });
    const chunks = [];
    const parentSignal = options.forkContext?.signal;
    const childController = new AbortController();
    const childSignal = parentSignal
        ? AbortSignal.any([childController.signal, parentSignal])
        : childController.signal;
    const strictK3 = isStrictKimiK3Adapter(adapter);
    if (options.forkContext?.session && !strictK3Parent && !strictK3) {
        agent.restoreSession(options.forkContext.session);
    }
    const runPrompt = (strictK3Parent || strictK3) && options.forkContext?.messages
        ? `${buildSynthesizedProviderContext('subagent', options.forkContext.messages)}\n\n`
            + `Current child task:\n${options.prompt}`
        : options.prompt;
    try {
        await agent.runTurn(runPrompt, (chunk) => {
            if (chunk.type === 'text') {
                chunks.push(chunk.delta);
            }
        }, childSignal);
    }
    finally {
        if (resolved.allocation && resolved.allocation.cleanup === 'delete') {
            await options.worktreeManager?.release(resolved.allocation.path);
        }
    }
    return chunks.join('').trim();
}
function resolveSubAgentAdapter(adapter, modelOverride, capabilityOverride, ctx) {
    if (modelOverride && capabilityOverride) {
        throw new Error('model and modelCapability are mutually exclusive');
    }
    if (modelOverride) {
        if (!supportsModelClone(adapter))
            return adapter;
        return adapter.cloneWithModel(modelOverride);
    }
    if (capabilityOverride) {
        if (!ctx?.settingsStore)
            throw new Error('settings context required for capability routing');
        const resolved = resolveCapability(capabilityOverride, ctx);
        if (!resolved)
            throw new Error(`unknown capability: ${capabilityOverride}`);
        if (!supportsModelClone(adapter))
            throw new Error('model clone required for capability routing');
        return adapter.cloneWithModel(resolved);
    }
    return adapter;
}
function resolveCapability(capability, ctx) {
    const settings = ctx.settingsStore?.getSettings();
    return settings?.modelCapabilities?.[capability] || null;
}
function supportsModelClone(adapter) {
    return typeof adapter.cloneWithModel === 'function';
}
export async function resolveSubAgentCwd(manager, agent, sessionId, cwd = process.cwd()) {
    if (agent.isolation !== 'worktree') {
        return { cwd };
    }
    if (!manager) {
        throw new Error(`worktree manager is required for isolated agent ${agent.name}`);
    }
    const branch = `${agent.name}-${sessionId}`.replace(/[^a-zA-Z0-9._-]+/g, '-');
    const allocation = await manager.allocate({
        owner: agent.name,
        taskId: sessionId,
        branch,
        cleanup: agent.cleanup ?? 'keep',
    });
    return {
        cwd: allocation.path,
        allocation,
    };
}
