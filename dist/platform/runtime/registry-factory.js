import { ToolRegistry, buildToolList } from '../../ai/tools/index.js';
import { createSubAgentTool } from '../../ai/tools/subagent.js';
import { createHooksRunner } from '../../runtime/hooks-runner.js';
import { executeNamedSubAgent } from '../../ai/agents/subagent-executor.js';
import { applySandboxToTools } from '../sandbox/tool-wrappers.js';
import { createTeamTools } from '../teams/tools.js';
export function createPlatformRegistryFactory(options) {
    const runNamedSubAgent = async (agentName, prompt) => {
        const agentDef = options.platform.customAgents.find((agent) => agent.name === agentName);
        if (!agentDef) {
            throw new Error(`unknown subagent: ${agentName}`);
        }
        return executeNamedSubAgent({
            agentDef,
            prompt,
            sessionId: options.sessionId,
            adapter: options.adapter,
            createRegistry: createRegistryForCwd,
            buildSystemPrompt: options.buildSystemPrompt,
            worktreeManager: options.platform.worktreeManager,
        });
    };
    const backgroundRunner = options.platform.createBackgroundRunner(async ({ agent, prompt }) => runNamedSubAgent(agent, prompt), options.notifyBackgroundJob);
    function createRegistryForCwd(cwd, allowedTools) {
        const extraTools = [
            ...(options.workflowTools ?? []),
            ...createTeamTools(options.platform.teamService),
            ...options.platform.mcpTools,
            createSubAgentTool({
                source: options.source,
                sessionId: options.sessionId,
                adapter: options.adapter,
                agents: options.platform.customAgents,
                createRegistry: createRegistryForCwd,
                buildSystemPrompt: options.buildSystemPrompt,
                backgroundRunner,
                worktreeManager: options.platform.worktreeManager,
                getTaskId: options.getCurrentTaskId,
            }),
        ];
        const allTools = applySandboxToTools(buildToolList(options.skillTool, { cwd }, extraTools), options.platform.sandboxEnforcer);
        const filteredTools = allowedTools?.length
            ? allTools.filter((tool) => allowedTools.includes(tool.definition.name))
            : allTools;
        return new ToolRegistry({
            permissionManager: options.permissionManager,
            dryRun: options.dryRun,
            hooksRunner: createHooksRunner({
                pre: options.platform.pluginRuntime.hookCommands.map((command) => ({ command })),
            }),
            onPrompt: options.onPrompt,
        }, filteredTools);
    }
    return {
        createRegistry: createRegistryForCwd,
    };
}
