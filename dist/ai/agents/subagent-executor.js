import { Agent } from '../agent.js';
export async function executeNamedSubAgent(options) {
    const resolved = await resolveSubAgentCwd(options.worktreeManager, options.agentDef, options.sessionId, options.cwd);
    const cwd = resolved.cwd;
    const registry = options.createRegistry(cwd, options.agentDef.allowedTools, options.agentDef.name);
    const systemPromptBase = options.forkContext?.systemPrompt ?? await options.buildSystemPrompt(cwd);
    const systemPrompt = [systemPromptBase, options.agentDef.systemPrompt].filter(Boolean).join('\n\n');
    const baseAdapter = options.adapter();
    const adapter = resolveSubAgentAdapter(baseAdapter, options.agentDef.model);
    const agent = new Agent(adapter, registry, systemPrompt, {
        maxIterations: options.agentDef.maxIterations,
    });
    const chunks = [];
    if (options.forkContext?.session) {
        agent.restoreSession(options.forkContext.session);
    }
    try {
        await agent.runTurn(options.prompt, (chunk) => {
            if (chunk.type === 'text') {
                chunks.push(chunk.delta);
            }
        });
    }
    finally {
        if (resolved.allocation && resolved.allocation.cleanup === 'delete') {
            await options.worktreeManager?.release(resolved.allocation.path);
        }
    }
    return chunks.join('').trim();
}
function resolveSubAgentAdapter(adapter, modelOverride) {
    if (!modelOverride || !supportsModelClone(adapter)) {
        return adapter;
    }
    return adapter.cloneWithModel(modelOverride);
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
