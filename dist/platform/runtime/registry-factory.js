import { ToolRegistry, buildToolList } from '../../ai/tools/index.js';
import { createLspTool } from '../../ai/tools/lsp.js';
import { createSubAgentTool } from '../../ai/tools/subagent.js';
import { createHooksRunner } from '../../runtime/hooks-runner.js';
import { executeNamedSubAgent } from '../../ai/agents/subagent-executor.js';
import { applySandboxToTools } from '../sandbox/tool-wrappers.js';
import { createTeamTools } from '../teams/tools.js';
export function createPlatformRegistryFactory(options) {
    const runNamedSubAgent = async (agentName, prompt, cwd) => {
        const agentDef = options.platform.customAgents.find((agent) => agent.name === agentName);
        if (!agentDef) {
            throw new Error(`unknown subagent: ${agentName}`);
        }
        return executeNamedSubAgent({
            agentDef,
            prompt,
            sessionId: options.sessionId,
            cwd,
            adapter: options.adapter,
            createRegistry: createRegistryForCwd,
            buildSystemPrompt: options.buildSystemPrompt,
            worktreeManager: options.platform.worktreeManager,
        });
    };
    const backgroundRunner = options.platform.createBackgroundRunner(async ({ agent, prompt, cwd }) => runNamedSubAgent(agent, prompt, cwd), options.notifyBackgroundJob);
    function createRegistryForCwd(cwd, allowedTools) {
        const extraTools = [
            ...(options.workflowTools ?? []),
            ...createTeamTools(options.platform.teamService),
            ...options.platform.mcpTools,
            createLspTool({ getLspClient: () => options.platform.lspClient, cwd }),
            createSubAgentTool({
                source: options.source,
                sessionId: options.sessionId,
                cwd,
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
            capabilityRegistry: options.platform.capabilityRegistry,
            permissionManager: options.permissionManager,
            dryRun: options.dryRun,
            hooksRunner: createHooksRunner({
                hooks: options.platform.pluginRuntime.hookConfigs,
            }),
            onPrompt: options.onPrompt,
        }, filteredTools);
    }
    return {
        createRegistry: createRegistryForCwd,
    };
}
