import { execFile } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { Tool } from '../../types.js';
import { loadCustomAgents, type CustomAgentDef } from '../../ai/agents/loader.js';
import { buildMcpRuntimeTools } from '../../ai/mcp/runtime/tools.js';
import { createComputerUseTool } from '../../ai/tools/computer-use.js';
import { normalizeMcpRuntimeToolResult } from '../../ai/mcp/runtime/client.js';
import { createBackgroundRunner, type BackgroundJobRecord } from '../agents/background-runner.js';
import { createLspManager } from '../lsp/manager.js';
import { loadPlatformPluginRuntime, connectDeclaredLspServer, type PlatformPluginRuntimeState } from '../plugins/runtime.js';
import { createSandboxEnforcer } from '../sandbox/enforcer.js';
import { createSandboxPolicy } from '../sandbox/policy.js';
import { FileTeamStore } from '../teams/store.js';
import { createTeamService, type TeamService } from '../teams/service.js';
import { createWorktreeManager, type WorktreeManager } from '../worktrees/manager.js';
import { ReminderClientService } from '../../runtime/reminder/client.js';
import { resolveXiaokDaemonSocketPath } from '../../runtime/reminder/ipc.js';
import { createReminderService, type ReminderApi } from '../../runtime/reminder/service.js';
import { CapabilityRegistry } from './capability-registry.js';
import { FileCapabilityHealthStore } from './health-store.js';
import {
  loadSettingsMcpServers,
  loadPluginMcpServers,
  mergeMcpServerConfigs,
  type McpServerConfigConflict,
} from '../mcp/config.js';
import { createMcpClientConnection, resolveMcpCallToolTimeoutMs, resolveMcpStartupTimeoutMs, resolveStdioCommand } from '../mcp/transport.js';
import type { NamedMcpServerConfig } from '../mcp/types.js';
import {
  BUILT_IN_MCP_CLASSIFICATIONS,
  classifyMcpServer,
  validateRegistry,
  type McpClassificationEntry,
} from '../mcp/server-classification.js';

export interface LspClientLike {
  didOpenDocument(document: { uri: string; languageId: string; version?: number; text: string }): Promise<void>;
  goToDefinition(uri: string, line: number, character: number): Promise<unknown>;
  findReferences(uri: string, line: number, character: number): Promise<unknown>;
  hover(uri: string, line: number, character: number): Promise<unknown>;
  documentSymbols(uri: string): Promise<unknown>;
  dispose(): void;
}

export interface PlatformRuntimeContext {
  pluginRuntime: PlatformPluginRuntimeState;
  customAgents: CustomAgentDef[];
  lspManager: ReturnType<typeof createLspManager>;
  lspClient: LspClientLike | undefined;
  teamService: TeamService;
  sandboxPolicy: ReturnType<typeof createSandboxPolicy>;
  sandboxEnforcer: ReturnType<typeof createSandboxEnforcer>;
  worktreeManager: WorktreeManager;
  mcpTools: Tool[];
  mcpReady: Promise<void>;
  onMcpToolsChanged(listener: (tools: Tool[]) => void): () => void;
  capabilityRegistry: CapabilityRegistry;
  reminderDefaultTimeZone: string;
  createReminderApi(sessionId: string, creatorUserId: string): ReminderApi;
  health: PlatformRuntimeHealth;
  dispose(): Promise<void>;
  listBackgroundJobs(sessionId: string): BackgroundJobRecord[];
  createBackgroundRunner(
    execute: (input: { agent: string; prompt: string; cwd?: string; parentDepth?: number }) => Promise<string>,
    notify?: (job: BackgroundJobRecord) => Promise<void> | void,
  ): ReturnType<typeof createBackgroundRunner>;
}

export interface PlatformCapabilityHealth {
  kind: 'mcp' | 'lsp';
  name: string;
  status: 'connected' | 'degraded' | 'deferred';
  detail: string;
}

export interface PlatformRuntimeHealth {
  capabilities: PlatformCapabilityHealth[];
  summary(): string;
  hasDegradedCapabilities(): boolean;
  snapshot(): {
    updatedAt: number;
    summary: string;
    capabilities: PlatformCapabilityHealth[];
  };
}

export interface CreatePlatformRuntimeContextOptions {
  cwd: string;
  builtinCommands: string[];
  reminderMode?: 'daemon' | 'local';
  reminderSocketPath?: string;
  mcpClassificationRegistry?: readonly McpClassificationEntry[];
  platform?: NodeJS.Platform;
}

export async function createPlatformRuntimeContext(
  options: CreatePlatformRuntimeContextOptions,
): Promise<PlatformRuntimeContext> {
  const pluginRuntime = await loadPlatformPluginRuntime(options.cwd, options.builtinCommands);
  const customAgents = await loadCustomAgents(undefined, options.cwd, pluginRuntime.agentDirs);
  const lspManager = createLspManager();
  const capabilityRegistry = new CapabilityRegistry();
  const capabilityHealth: PlatformCapabilityHealth[] = [];
  const disposables: Array<{ dispose(): void }> = [];
  const stateRootDir = join(options.cwd, '.xiaok', 'state');
  const healthStore = new FileCapabilityHealthStore(join(stateRootDir, 'capability-health.json'));
  const teamService = createTeamService({ store: new FileTeamStore(join(stateRootDir, 'teams.json')) });
  const reminderDefaultTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC';
  const reminderApis: ReminderApi[] = [];
  const createReminderApi = (sessionId: string, creatorUserId: string): ReminderApi => {
    const api = options.reminderMode === 'local'
      ? createReminderService({
        dbPath: join(stateRootDir, 'reminders.sqlite'),
        defaultTimeZone: reminderDefaultTimeZone,
      })
      : new ReminderClientService({
        workspaceRoot: options.cwd,
        sessionId,
        creatorUserId,
        defaultTimeZone: reminderDefaultTimeZone,
        socketPath: options.reminderSocketPath ?? resolveXiaokDaemonSocketPath(),
      });
    reminderApis.push(api);
    return api;
  };
  const sandboxPolicy = createSandboxPolicy({
    pathAllowlist: [options.cwd, join(options.cwd, '.xiaok'), join(options.cwd, '.worktrees')],
    network: 'allow',
  });
  const sandboxEnforcer = createSandboxEnforcer(sandboxPolicy);
  const worktreeManager = createWorktreeManager({
    repoRoot: options.cwd,
    worktreesDir: join(options.cwd, '.worktrees'),
    execGit: async (args) =>
      new Promise<string>((resolve, reject) => {
        execFile('git', args, { cwd: options.cwd }, (error, stdout, stderr) => {
          if (error) {
            reject(new Error(stderr || error.message));
            return;
          }
          resolve(stdout.trim());
        });
      }),
  });
  // 加载 MCP server 配置（settings.json + plugin manifests）
  const settingsMcpServers = loadSettingsMcpServers();
  const pluginMcpServers = loadPluginMcpServers(pluginRuntime);
  const { servers: mergedMcpServers, conflicts: mcpConflicts } = mergeMcpServerConfigs(
    settingsMcpServers,
    pluginMcpServers,
  );
  const classificationRegistry = options.mcpClassificationRegistry ?? BUILT_IN_MCP_CLASSIFICATIONS;
  validateRegistry(classificationRegistry);
  const runtimePlatform = options.platform ?? process.platform;
  const mcpTools: Tool[] = [];
  const mcpToolListeners = new Set<(tools: Tool[]) => void>();
  let disposed = false;

  for (const conflict of mcpConflicts) {
    capabilityHealth.push(buildConflictHealthEntry(conflict));
  }

  for (const agent of customAgents) {
    capabilityRegistry.register({
      kind: 'agent',
      name: agent.name,
      description: agent.model ? `subagent:${agent.model}` : 'subagent',
    });
  }
  const lspClient = await connectWorkspaceLspServers(pluginRuntime, lspManager, options.cwd, capabilityHealth, disposables);
  const health = createPlatformRuntimeHealth(capabilityHealth);
  healthStore.set(options.cwd, health.snapshot());

  const registerDisposable = (disposable: { dispose(): void }): boolean => {
    if (disposed) {
      try {
        disposable.dispose();
      } catch {}
      return false;
    }
    disposables.push(disposable);
    return true;
  };
  const publishMcpTools = (tools: Tool[]): void => {
    if (disposed || tools.length === 0) {
      return;
    }
    mcpTools.push(...tools);
    for (const tool of tools) {
      capabilityRegistry.register({
        kind: 'mcp',
        name: tool.definition.name,
        description: tool.definition.description,
        inputSchema: tool.definition.inputSchema,
      });
    }
    for (const listener of mcpToolListeners) {
      try {
        listener(tools);
      } catch {}
    }
  };
  const mcpReady = connectWorkspaceMcpServers(
    mergedMcpServers,
    capabilityHealth,
    registerDisposable,
    () => disposed,
    classificationRegistry,
    runtimePlatform,
  ).then((tools) => {
    publishMcpTools(tools);
    healthStore.set(options.cwd, health.snapshot());
  }).catch((error) => {
    capabilityHealth.push({
      kind: 'mcp',
      name: 'startup',
      status: 'degraded',
      detail: error instanceof Error ? error.message : String(error),
    });
    healthStore.set(options.cwd, health.snapshot());
  });

  return {
    pluginRuntime,
    customAgents,
    lspManager,
    lspClient,
    teamService,
    sandboxPolicy,
    sandboxEnforcer,
    worktreeManager,
    mcpTools,
    mcpReady,
    onMcpToolsChanged(listener) {
      mcpToolListeners.add(listener);
      return () => {
        mcpToolListeners.delete(listener);
      };
    },
    capabilityRegistry,
    reminderDefaultTimeZone,
    createReminderApi,
    health,
    async dispose() {
      disposed = true;
      for (const reminderApi of reminderApis.splice(0)) {
        await reminderApi.dispose();
      }
      await mcpReady.catch(() => undefined);
      for (const disposable of disposables.splice(0).reverse()) {
        try {
          disposable.dispose();
        } catch {
          continue;
        }
      }
    },
    listBackgroundJobs(sessionId: string) {
      return createBackgroundRunner({
        rootDir: join(stateRootDir, 'background-jobs'),
        recoverInterruptedJobs: false,
        execute: async () => ({ ok: true, summary: 'unused' }),
        notify: async () => undefined,
      }).listBySession(sessionId);
    },
    createBackgroundRunner(execute, notify = async () => undefined) {
      return createBackgroundRunner({
        rootDir: join(stateRootDir, 'background-jobs'),
        execute: async ({ input }) => {
          const payload = input as { agent?: string; prompt?: string; cwd?: string; parentDepth?: number };
          if (!payload.agent || !payload.prompt) {
            return { ok: false, errorMessage: 'invalid background subagent payload' };
          }

          const result = await execute({
            agent: payload.agent,
            prompt: payload.prompt,
            cwd: payload.cwd,
            parentDepth: payload.parentDepth,
          });
          return { ok: true, summary: result.slice(0, 200) };
        },
        notify: async (job) => {
          await notifyBackgroundTeam(job, teamService);
          await notify(job);
        },
      });
    },
  };
}

async function connectWorkspaceLspServers(
  pluginRuntime: PlatformPluginRuntimeState,
  lspManager: ReturnType<typeof createLspManager>,
  cwd: string,
  capabilityHealth: PlatformCapabilityHealth[],
  disposables: Array<{ dispose(): void }>,
): Promise<LspClientLike | undefined> {
  const rootUri = pathToFileUri(cwd);
  const openableDocuments = collectLspSeedDocuments(cwd);
  let firstClient: LspClientLike | undefined;

  for (const declaration of pluginRuntime.lspServers) {
    try {
      const connection = await connectDeclaredLspServer(declaration, lspManager, rootUri);
      for (const document of openableDocuments) {
        await connection.didOpenDocument(document);
      }
      disposables.push(connection);
      firstClient ??= connection;
      capabilityHealth.push({
        kind: 'lsp',
        name: declaration.name,
        status: 'connected',
        detail: `seeded ${openableDocuments.length} documents`,
      });
    } catch (error) {
      capabilityHealth.push({
        kind: 'lsp',
        name: declaration.name,
        status: 'degraded',
        detail: error instanceof Error ? error.message : String(error),
      });
      continue;
    }
  }
  return firstClient;
}

async function connectWorkspaceMcpServers(
  servers: NamedMcpServerConfig[],
  capabilityHealth: PlatformCapabilityHealth[],
  registerDisposable: (disposable: { dispose(): void }) => boolean,
  shouldStop: () => boolean = () => false,
  classificationRegistry: readonly McpClassificationEntry[] = BUILT_IN_MCP_CLASSIFICATIONS,
  platform: NodeJS.Platform = process.platform,
): Promise<Tool[]> {
  const tools: Tool[] = [];
  const startupTimeoutMs = resolveMcpStartupTimeoutMs();
  const callToolTimeoutMs = resolveMcpCallToolTimeoutMs();

  for (const server of servers) {
    if (shouldStop()) {
      break;
    }

    const policy = classifyMcpServer(server, classificationRegistry);

    if (policy.activation.mode === 'lazy' && policy.activation.adapter === 'cua-computer-use-wrapper') {
      if (platform !== 'darwin') {
        capabilityHealth.push({
          kind: 'mcp',
          name: server.name,
          status: 'degraded',
          detail: 'Computer Use / CUA is macOS-only and is disabled on this platform',
        });
        continue;
      }

      const frozenSnapshot = freezeServerSnapshot(server);
      const { CuaConnectionManager } = await import('../mcp/cua-connection-manager.js');
      const cuaManager = new CuaConnectionManager(async () => {
        const conn = await createMcpClientConnection(server.name, frozenSnapshot);
        registerDisposable(conn);
        return {
          callToolResult: async (name, input) => {
            const result = await conn.client.callTool({ name, arguments: input });
            return normalizeMcpRuntimeToolResult(result);
          },
          dispose: () => conn.dispose(),
        };
      });
      tools.push(createComputerUseTool({
        callToolResult: (name, input) => cuaManager.callToolResult(name, input),
      }));
      registerDisposable({ dispose: () => { cuaManager.dispose(); } });
      capabilityHealth.push({
        kind: 'mcp',
        name: server.name,
        status: 'deferred',
        detail: policy.reason || 'lazy activation',
      });
      continue;
    }

    let connection: Awaited<ReturnType<typeof createMcpClientConnection>> | undefined;
    try {
      connection = await createMcpClientConnection(server.name, server);
      const activeConnection = connection;

      const toolsResult = await activeConnection.client.listTools(undefined, { timeout: startupTimeoutMs });
      const schemas = toolsResult.tools ?? [];

      tools.push(
        ...buildMcpRuntimeTools(
          { name: server.name, command: '' },
          {
            listTools: async () => schemas,
            callTool: async (name, input) => {
              const result = await activeConnection.client.callTool(
                { name, arguments: input },
                undefined,
                { timeout: callToolTimeoutMs, resetTimeoutOnProgress: true },
              );
              return normalizeMcpRuntimeToolResult(result).text;
            },
            dispose: activeConnection.dispose,
          },
          schemas,
        ),
      );

      if (!registerDisposable(activeConnection)) {
        connection = undefined;
        continue;
      }
      connection = undefined;
      const detailParts: string[] = [`${schemas.length} tools`];
      if (policy.source === 'legacy-manifest' && policy.reason) {
        detailParts.push(policy.reason);
      }
      capabilityHealth.push({
        kind: 'mcp',
        name: server.name,
        status: 'connected',
        detail: detailParts.join('; '),
      });
    } catch (error) {
      connection?.dispose();
      const detailParts: string[] = [error instanceof Error ? error.message : String(error)];
      if (policy.source === 'legacy-manifest' && policy.reason) {
        detailParts.unshift(policy.reason);
      }
      capabilityHealth.push({
        kind: 'mcp',
        name: server.name,
        status: 'degraded',
        detail: detailParts.join('; '),
      });
    }
  }

  return tools;
}

/**
 * 把 lazy 激活前的 launch plan 冻结成 plain object。
 * - stdio: 解析 command + 合并 process.env + 平台特化,激活时不再读 process.env。
 * - 其它 transport: 浅拷贝避免后续 manifest 变更影响。
 */
function freezeServerSnapshot(server: NamedMcpServerConfig): NamedMcpServerConfig {
  if (server.type === 'stdio') {
    const platform = process.platform;
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries({ ...process.env, ...server.env })) {
      if (value !== undefined) {
        env[key] = value;
      }
    }
    return Object.freeze({
      ...server,
      command: resolveStdioCommand(server.command, platform),
      args: server.args ? [...server.args] : [],
      env,
    }) as NamedMcpServerConfig;
  }
  return Object.freeze({ ...server }) as NamedMcpServerConfig;
}

function buildConflictHealthEntry(conflict: McpServerConfigConflict): PlatformCapabilityHealth {
  const winner = conflict.winner.pluginName ?? conflict.winner.origin;
  const loser = conflict.loser.pluginName ?? conflict.loser.origin;
  return {
    kind: 'mcp',
    name: conflict.name,
    status: 'degraded',
    detail: `mcp server "${conflict.name}" overridden: ${loser} -> ${winner}`,
  };
}

function collectLspSeedDocuments(cwd: string): Array<{ uri: string; languageId: string; text: string }> {
  const candidates = ['src/index.ts', 'src/commands/chat.ts', 'src/commands/yzj.ts', 'tsconfig.json']
    .map((relativePath) => join(cwd, relativePath));
  const docs: Array<{ uri: string; languageId: string; text: string }> = [];

  for (const filePath of candidates) {
    try {
      const text = readFileSync(filePath, 'utf8');
      docs.push({
        uri: pathToFileUri(filePath),
        languageId: filePath.endsWith('.json') ? 'json' : 'typescript',
        text,
      });
    } catch {
      continue;
    }
  }

  return docs;
}

function pathToFileUri(path: string): string {
  return `file://${path.startsWith('/') ? '' : '/'}${path.replace(/\\/g, '/')}`;
}

function createPlatformRuntimeHealth(capabilities: PlatformCapabilityHealth[]): PlatformRuntimeHealth {
  const updatedAt = Date.now();
  return {
    capabilities,
    summary() {
      if (capabilities.length === 0) {
        return 'capabilities: none declared';
      }

      return capabilities
        .map((entry) => `${entry.kind}:${entry.name} ${entry.status}${entry.detail ? ` (${entry.detail})` : ''}`)
        .join('\n');
    },
    hasDegradedCapabilities() {
      return capabilities.some((entry) => entry.status === 'degraded');
    },
    snapshot() {
      return {
        updatedAt,
        summary: this.summary(),
        capabilities: capabilities.map((entry) => ({ ...entry })),
      };
    },
  };
}

async function notifyBackgroundTeam(job: BackgroundJobRecord, teamService: TeamService): Promise<void> {
  const teamName = job.metadata?.team?.trim();
  if (!teamName) {
    return;
  }

  const team = teamService.findTeamByName(teamName);
  if (!team) {
    return;
  }

  const from = job.metadata?.agent ?? 'background';
  const status = job.status;
  const detail = job.resultSummary ?? job.errorMessage ?? job.inputSummary;
  teamService.sendMessage({
    teamId: team.teamId,
    from,
    to: team.name,
    body: `[background ${status}] ${detail}`,
  });
}
