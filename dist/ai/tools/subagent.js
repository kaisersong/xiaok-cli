import { executeNamedSubAgent } from '../agents/subagent-executor.js';
export function createSubAgentTool(options) {
    return {
        permission: 'safe',
        definition: {
            name: 'subagent',
            description: '执行一个已声明的自定义 sub-agent，可按需使用独立 worktree 或后台运行',
            inputSchema: {
                type: 'object',
                properties: {
                    agent: { type: 'string' },
                    prompt: { type: 'string' },
                    background: { type: 'boolean' },
                },
                required: ['agent', 'prompt'],
            },
        },
        async execute(input) {
            const invocation = input;
            const agentDef = options.agents.find((agent) => agent.name === invocation.agent);
            if (!agentDef) {
                return `Error: unknown subagent: ${invocation.agent}`;
            }
            const shouldRunInBackground = invocation.background ?? agentDef.background ?? false;
            if (shouldRunInBackground) {
                if (!options.backgroundRunner) {
                    return `Error: background runner is not configured for subagent ${agentDef.name}`;
                }
                const job = await options.backgroundRunner.start({
                    sessionId: options.sessionId,
                    source: options.source,
                    taskId: options.getTaskId?.(),
                    input: {
                        agent: agentDef.name,
                        prompt: invocation.prompt,
                    },
                });
                return `background subagent queued: ${job.jobId}`;
            }
            return executeNamedSubAgent({
                agentDef,
                prompt: invocation.prompt,
                sessionId: options.sessionId,
                adapter: options.adapter,
                createRegistry: options.createRegistry,
                buildSystemPrompt: options.buildSystemPrompt,
                worktreeManager: options.worktreeManager,
            });
        },
    };
}
