import { Agent } from '../agent.js';
export async function executeNamedSubAgent(options) {
    const cwd = await resolveSubAgentCwd(options.worktreeManager, options.agentDef, options.sessionId);
    const registry = options.createRegistry(cwd, options.agentDef.allowedTools);
    const systemPromptBase = await options.buildSystemPrompt(cwd);
    const systemPrompt = [systemPromptBase, options.agentDef.systemPrompt].filter(Boolean).join('\n\n');
    const agent = new Agent(options.adapter(), registry, systemPrompt, {
        maxIterations: options.agentDef.maxIterations,
    });
    const chunks = [];
    await agent.runTurn(options.prompt, (chunk) => {
        if (chunk.type === 'text') {
            chunks.push(chunk.delta);
        }
    });
    return chunks.join('').trim();
}
export async function resolveSubAgentCwd(manager, agent, sessionId) {
    if (agent.isolation !== 'worktree') {
        return process.cwd();
    }
    if (!manager) {
        throw new Error(`worktree manager is required for isolated agent ${agent.name}`);
    }
    const branch = `${agent.name}-${sessionId}`.replace(/[^a-zA-Z0-9._-]+/g, '-');
    const allocation = await manager.allocate({
        owner: agent.name,
        taskId: sessionId,
        branch,
        cleanup: 'keep',
    });
    return allocation.path;
}
