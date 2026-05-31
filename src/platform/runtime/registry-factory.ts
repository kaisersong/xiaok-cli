import type { ModelAdapter, Tool } from '../../types.js';
import { ToolRegistry, buildToolList, type ToolObservation } from '../../ai/tools/index.js';
import { createLspTool } from '../../ai/tools/lsp.js';
import { createSubAgentTool } from '../../ai/tools/subagent.js';
import { createHooksRunner } from '../../runtime/hooks-runner.js';
import { executeNamedSubAgent } from '../../ai/agents/subagent-executor.js';
import { applySandboxToTools } from '../sandbox/tool-wrappers.js';
import { createTeamTools } from '../teams/tools.js';
import { createReminderTools } from '../../ai/tools/reminders.js';
import { createNotebookTools } from '../../ai/tools/notebook.js';
import type { ReminderApi } from '../../runtime/reminder/service.js';
import type { PlatformRuntimeContext } from './context.js';
import { mergeToolPools, isMcpTool } from '../../ai/tools/tool-pool.js';

const CC_RUNTIME_ONLY_TOOLS = new Set([
  'Agent',
  'Skill',
  'EnterPlanMode',
  'ExitPlanMode',
  'EnterWorktree',
  'ExitWorktree',
]);

function isCcRuntimeOnlyTool(tool: Tool): boolean {
  const name = tool.definition.name;
  return CC_RUNTIME_ONLY_TOOLS.has(name) || /^Task(?:Create|Update|List|Get|Output|Stop)$/.test(name);
}

export interface PlatformRegistryFactoryOptions {
  platform: PlatformRuntimeContext;
  source: string;
  sessionId: string;
  transcriptPath?: string;
  adapter: () => ModelAdapter;
  skillTool?: Tool;
  workflowTools?: Tool[];
  memoryStore?: import('../../ai/memory/store.js').MemoryStore;
  dryRun?: boolean;
  permissionManager?: ConstructorParameters<typeof ToolRegistry>[0]['permissionManager'];
  onPrompt?: (toolName: string, input: Record<string, unknown>) => Promise<boolean>;
  onSandboxDenied?: (
    deniedPath: string,
    toolName: string,
  ) => Promise<{ shouldProceed: boolean }> | { shouldProceed: boolean };
  buildSystemPrompt(cwd: string): Promise<string>;
  notifyBackgroundJob?: Parameters<PlatformRuntimeContext['createBackgroundRunner']>[1];
  getCurrentTaskId?: () => string | undefined;
  onToolObserved?: (event: ToolObservation) => Promise<void> | void;
}

export interface PlatformRegistryFactory {
  createRegistry(
    cwd: string,
    allowedTools?: string[],
    agentId?: string,
    opts?: { parentDepth?: number },
  ): ToolRegistry;
  getReminderApi(): ReminderApi | undefined;
}

export function createPlatformRegistryFactory(options: PlatformRegistryFactoryOptions): PlatformRegistryFactory {
  const registries = new Set<ToolRegistry>();
  const registerMcpTools = (registry: ToolRegistry, tools: Tool[]): void => {
    const sandboxedTools = applySandboxToTools(tools, options.platform.sandboxEnforcer, {
      onSandboxDenied: options.onSandboxDenied,
    });
    const orderedTools = mergeToolPools([], sandboxedTools)
      .filter((tool) => !isCcRuntimeOnlyTool(tool));
    for (const tool of orderedTools) {
      registry.registerTool(tool);
    }
  };
  options.platform.onMcpToolsChanged((tools) => {
    for (const registry of registries) {
      registerMcpTools(registry, tools);
    }
  });

  const runNamedSubAgent = async (agentName: string, prompt: string, cwd?: string, parentDepth?: number): Promise<string> => {
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
      parentDepth,
    });
  };

  const backgroundRunner = options.platform.createBackgroundRunner(
    async ({ agent, prompt, cwd, parentDepth }) => runNamedSubAgent(agent, prompt, cwd, parentDepth),
    options.notifyBackgroundJob,
  );
  const reminders = options.source === 'chat'
    ? options.platform.createReminderApi(options.sessionId, options.sessionId)
    : undefined;
  if (reminders) {
    void reminders.start();
    reminders.registerInChatSink(options.sessionId, (message) => {
      process.stdout.write(`\n[reminder] ${message}\n`);
    });
  }

  function createRegistryForCwd(
    cwd: string,
    allowedTools?: string[],
    agentId = 'main',
    opts?: { parentDepth?: number },
  ): ToolRegistry {
    const extraTools = [
      ...(options.workflowTools ?? []),
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
        parentDepth: opts?.parentDepth,
      }),
    ];

    // 构建基础 tool list
    const baseTools = buildToolList(options.skillTool, { cwd }, extraTools);

    // 应用 sandbox
    const sandboxedTools = applySandboxToTools(baseTools, options.platform.sandboxEnforcer, {
      onSandboxDenied: options.onSandboxDenied,
    });

    // 合并 built-in 和 MCP tools（保证 ordering）
    const orderedTools = mergeToolPools(
      sandboxedTools.filter((t) => !isMcpTool(t)),
      sandboxedTools.filter(isMcpTool),
    ).filter((tool) => !isCcRuntimeOnlyTool(tool));

    // 过滤 allowedTools
    const filteredTools = allowedTools?.length
      ? orderedTools.filter((tool) => allowedTools.includes(tool.definition.name))
      : orderedTools;

    const registry = new ToolRegistry({
      capabilityRegistry: options.platform.capabilityRegistry,
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
    return registry;
  }

  return {
    createRegistry: createRegistryForCwd,
    getReminderApi() {
      return reminders;
    },
  };
}
