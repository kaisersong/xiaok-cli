import { getCanonicalToolId } from '../../ai/tools/tool-identity.js';
import { ToolRegistry, buildToolList } from '../../ai/tools/index.js';
import { createLspTool } from '../../ai/tools/lsp.js';
import { createSubAgentTool } from '../../ai/tools/subagent.js';
import { createHooksRunner } from '../../runtime/hooks-runner.js';
import { createNamedSubAgentSession, executeNamedSubAgent, } from '../../ai/agents/subagent-executor.js';
import { createMultiAgentCoordinator } from '../../ai/agents/multi-agent-coordinator.js';
import { CHILD_COMMUNICATION_TOOL_NAMES, createMultiAgentTools, } from '../../ai/tools/multi-agent.js';
import { applySandboxToTools } from '../sandbox/tool-wrappers.js';
import { createTeamTools } from '../teams/tools.js';
import { createReminderTools } from '../../ai/tools/reminders.js';
import { createNotebookTools } from '../../ai/tools/notebook.js';
import { mergeToolPools } from '../../ai/tools/tool-pool.js';
const CC_RUNTIME_ONLY_TOOLS = new Set([
    'Agent',
    'Skill',
    'EnterPlanMode',
    'ExitPlanMode',
    'EnterWorktree',
    'ExitWorktree',
]);
function isCcRuntimeOnlyTool(tool) {
    const name = tool.definition.name;
    return CC_RUNTIME_ONLY_TOOLS.has(name) || /^Task(?:Create|Update|List|Get|Output|Stop)$/.test(name);
}
export function filterWorkflowToolsForAgent(tools, agentId) {
    if (agentId === 'main')
        return tools;
    return tools.filter((tool) => !tool.definition.name.startsWith('goal_'));
}
export function createPlatformRegistryFactory(options) {
    const registries = new Set();
    let factoryDisposed = false;
    const multiAgentCoordinator = options.source === 'chat'
        ? createMultiAgentCoordinator({
            maxDepth: readPositiveIntegerEnv('XIAOK_SUBAGENT_MAX_DEPTH'),
            maxResidentAgents: readPositiveIntegerEnv('XIAOK_MAX_AGENT_THREADS'),
            idleTimeoutMs: readPositiveIntegerEnv('XIAOK_SUBAGENT_IDLE_TIMEOUT_MS'),
            turnTimeoutMs: readPositiveIntegerEnv('XIAOK_SUBAGENT_TURN_TIMEOUT_MS'),
            onEvent: options.onMultiAgentEvent,
        })
        : undefined;
    const handleSandboxDenied = async (deniedPath, toolName) => {
        if (options.permissionManager?.getMode() === 'auto') {
            options.platform.sandboxPolicy.expandAllowedPaths([deniedPath]);
            return { shouldProceed: true };
        }
        return options.onSandboxDenied?.(deniedPath, toolName) ?? { shouldProceed: false };
    };
    const registryMcpState = new Map();
    const registerMcpTools = (registry, tools) => {
        const state = registryMcpState.get(registry);
        const sandboxedTools = applySandboxToTools(expandMcpCatalog(tools), options.platform.sandboxEnforcer, {
            onSandboxDenied: handleSandboxDenied,
        });
        const orderedTools = mergeToolPools([], sandboxedTools)
            .filter((tool) => !isCcRuntimeOnlyTool(tool) && !state.baseNames.has(tool.definition.name) && (!state.allowed || state.allowed.has(getCanonicalToolId(tool.definition.name))));
        const nextNames = new Set(orderedTools.map((tool) => tool.definition.name));
        for (const [name, installed] of state.installed) {
            if (!nextNames.has(name)) {
                registry.unregisterTool(name, installed);
                state.installed.delete(name);
            }
        }
        for (const tool of orderedTools) {
            const name = tool.definition.name;
            const current = registry.getRegisteredTool(name);
            if (current && current !== state.installed.get(name)) {
                state.installed.delete(name);
                continue;
            }
            if (current !== tool)
                registry.registerTool(tool);
            state.installed.set(name, tool);
        }
    };
    const unsubscribeMcpTools = options.platform.onMcpToolsChanged((tools) => {
        for (const registry of registries) {
            registerMcpTools(registry, tools);
        }
    });
    const releaseRegistry = (registry) => {
        registries.delete(registry);
        registryMcpState.delete(registry);
        registry.dispose();
    };
    const runNamedSubAgent = async (agentName, prompt, cwd, parentDepth, signal) => {
        const agentDef = options.platform.customAgents.find((agent) => agent.name === agentName);
        if (!agentDef) {
            throw new Error(`unknown subagent: ${agentName}`);
        }
        return executeNamedSubAgent({
            onSubAgentEvent: options.onSubAgentEvent,
            agentDef,
            prompt,
            sessionId: options.sessionId,
            cwd,
            adapter: options.adapter,
            createRegistry: createRegistryForCwd,
            releaseRegistry,
            buildSystemPrompt: options.buildSystemPrompt,
            worktreeManager: options.platform.worktreeManager,
            parentDepth,
            signal,
        });
    };
    const backgroundRunner = options.platform.createBackgroundRunner(async ({ agent, prompt, cwd, parentDepth, signal }) => runNamedSubAgent(agent, prompt, cwd, parentDepth, signal), options.notifyBackgroundJob);
    const reminders = options.source === 'chat'
        ? options.platform.createReminderApi(options.sessionId, options.sessionId)
        : undefined;
    if (reminders) {
        void reminders.start();
        reminders.registerInChatSink(options.sessionId, (message) => {
            process.stdout.write(`\n[reminder] ${message}\n`);
        });
    }
    function createRegistryForCwd(cwd, allowedTools, agentId = 'main', opts) {
        if (factoryDisposed)
            throw new Error('platform registry factory is disposed');
        const coordinatorToolsAvailable = multiAgentCoordinator?.listAgents({ requestSource: 'agent', callerId: 'main' })
            .some((agent) => agent.id === agentId) ?? false;
        const multiAgentTools = multiAgentCoordinator && coordinatorToolsAvailable
            ? createMultiAgentTools({
                coordinator: multiAgentCoordinator,
                callerId: agentId,
                agents: options.platform.customAgents,
                createSession: ({ agentDef, identity, signal, forkContext, taskDescription }) => createNamedSubAgentSession({
                    onSubAgentEvent: options.onSubAgentEvent,
                    taskDescription,
                    agentDef,
                    signal,
                    sessionId: options.sessionId,
                    cwd,
                    adapter: options.adapter,
                    createRegistry: createRegistryForCwd,
                    releaseRegistry,
                    buildSystemPrompt: options.buildSystemPrompt,
                    worktreeManager: options.platform.worktreeManager,
                    forkContext,
                    parentDepth: identity.depth,
                    runtimeAgentId: identity.id,
                    collaborationPrompt: buildCollaborationPrompt(identity),
                }),
            })
            : [];
        const extraTools = [
            ...filterWorkflowToolsForAgent(options.workflowTools ?? [], agentId),
            ...(reminders
                ? createReminderTools({
                    reminders,
                    sessionId: options.sessionId,
                    creatorUserId: options.sessionId,
                    timezone: options.platform.reminderDefaultTimeZone,
                })
                : []),
            ...createTeamTools(options.platform.teamService),
            ...(options.memoryStore ? createNotebookTools(options.memoryStore) : []),
            createLspTool({ getLspClient: () => options.platform.lspClient, cwd }),
            createSubAgentTool({
                onSubAgentEvent: options.onSubAgentEvent,
                source: options.source,
                sessionId: options.sessionId,
                cwd,
                adapter: options.adapter,
                agents: options.platform.customAgents,
                createRegistry: createRegistryForCwd,
                releaseRegistry,
                buildSystemPrompt: options.buildSystemPrompt,
                backgroundRunner,
                worktreeManager: options.platform.worktreeManager,
                getTaskId: options.getCurrentTaskId,
                parentDepth: opts?.parentDepth,
            }),
            ...multiAgentTools,
        ];
        // 构建基础 tool list
        const baseTools = buildToolList(options.skillTool, { cwd, allowOutsideCwd: Boolean(options.platform.sandboxEnforcer) }, extraTools);
        // 应用 sandbox
        const sandboxedTools = applySandboxToTools(baseTools, options.platform.sandboxEnforcer, {
            onSandboxDenied: handleSandboxDenied,
        });
        // 合并 built-in 和 MCP tools（保证 ordering）
        const sandboxedMcpTools = applySandboxToTools(expandMcpCatalog(options.platform.mcpTools), options.platform.sandboxEnforcer, {
            onSandboxDenied: handleSandboxDenied,
        });
        const orderedTools = mergeToolPools(sandboxedTools, sandboxedMcpTools)
            .filter((tool) => !isCcRuntimeOnlyTool(tool));
        // 过滤 allowedTools
        const allowedToolIds = allowedTools?.length ? new Set(allowedTools.map(getCanonicalToolId)) : undefined;
        const filteredTools = allowedToolIds
            ? orderedTools.filter((tool) => (allowedToolIds.has(getCanonicalToolId(tool.definition.name))
                || (coordinatorToolsAvailable && agentId !== 'main' && CHILD_COMMUNICATION_TOOL_NAMES.has(tool.definition.name))))
            : orderedTools;
        const registry = new ToolRegistry({
            capabilityRegistry: options.platform.capabilityRegistry,
            capabilitySearch: agentId === 'main',
            permissionManager: options.permissionManager,
            dryRun: options.dryRun,
            hooksRunner: createHooksRunner({
                hooks: options.platform.pluginRuntime.hookConfigs,
                context: {
                    session_id: options.sessionId,
                    cwd,
                    transcript_path: options.transcriptPath,
                },
            }),
            onPrompt: options.onPrompt,
            agentId,
            onToolObserved: options.onToolObserved,
        }, filteredTools);
        registries.add(registry);
        const platformMcpInstances = new Set(sandboxedMcpTools);
        const baseNames = new Set(sandboxedTools.map((tool) => tool.definition.name));
        baseNames.add('tool_search');
        registryMcpState.set(registry, {
            installed: new Map(filteredTools.filter((tool) => platformMcpInstances.has(tool)).map((tool) => [tool.definition.name, tool])),
            baseNames,
            allowed: allowedToolIds,
        });
        return registry;
    }
    return {
        createRegistry: createRegistryForCwd,
        getReminderApi() {
            return reminders;
        },
        async dispose() {
            if (factoryDisposed)
                return;
            factoryDisposed = true;
            unsubscribeMcpTools();
            try {
                const backgroundShutdown = backgroundRunner.dispose();
                const agentShutdown = multiAgentCoordinator?.dispose();
                for (const registry of registries)
                    registry.dispose();
                await Promise.all([backgroundShutdown, agentShutdown]);
            }
            finally {
                for (const registry of registries)
                    registry.dispose();
                registries.clear();
                registryMcpState.clear();
            }
        },
    };
}
function expandMcpCatalog(tools) {
    const pending = [...tools];
    const visited = new Set();
    const expanded = [];
    for (let index = 0; index < pending.length; index++) {
        const tool = pending[index];
        if (visited.has(tool))
            continue;
        visited.add(tool);
        if (tool.companionTools?.length) {
            pending.push(...tool.companionTools);
            const { companionTools: _companions, ...standalone } = tool;
            expanded.push(standalone);
        }
        else {
            expanded.push(tool);
        }
    }
    return expanded;
}
function readPositiveIntegerEnv(name) {
    const value = process.env[name];
    if (!value)
        return undefined;
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}
function buildCollaborationPrompt(identity) {
    return [
        '<xiaok_multi_agent_context>',
        `You are subagent ${identity.canonicalName} (id=${identity.id}).`,
        `Your parent is ${identity.parentCanonicalName} (id=${identity.parentId}).`,
        'Use send_message to report progress, findings, or questions to your parent; target main to reach the root agent.',
        'send_message does not start a new turn. Messages to a running child are delivered at the next complete model-request boundary; wait_agent can also receive replies.',
        'Use interrupt_agent for cancellation, not a message. A failed timeout is not successful completion; do not repeatedly wait or automatically retry it.',
        '</xiaok_multi_agent_context>',
    ].join('\n');
}
