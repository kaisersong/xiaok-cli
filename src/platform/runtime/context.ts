import { execFile } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { Tool } from '../../types.js';
import { loadCustomAgents, type CustomAgentDef } from '../../ai/agents/loader.js';
import { buildMcpRuntimeTools } from '../../ai/mcp/runtime/tools.js';
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
} from '../mcp/config.js';
import { createMcpClientConnection } from '../mcp/transport.js';
import type { NamedMcpServerConfig } from '../mcp/types.js';

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
  capabilityRegistry: CapabilityRegistry;
  reminderDefaultTimeZone: string;
  createReminderApi(sessionId: string, creatorUserId: string): ReminderApi;
  health: PlatformRuntimeHealth;
  dispose(): Promise<void>;
  listBackgroundJobs(sessionId: string): BackgroundJobRecord[];
  createBackgroundRunner(
    execute: (input: { agent: string; prompt: string; cwd?: string }) => Promise<string>,
    notify?: (job: BackgroundJobRecord) => Promise<void> | void,
  ): ReturnType<typeof createBackgroundRunner>;
}

export interface PlatformCapabilityHealth {
  kind: 'mcp' | 'lsp';
  name: string;
  status: 'connected' | 'degraded';
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
  const mergedMcpServers = mergeMcpServerConfigs(settingsMcpServers, pluginMcpServers);

  // 连接 MCP servers
  const mcpTools = await connectWorkspaceMcpServers(mergedMcpServers, capabilityHealth, disposables);
  for (const agent of customAgents) {
    capabilityRegistry.register({
      kind: 'agent',
      name: agent.name,
      description: agent.model ? `subagent:${agent.model}` : 'subagent',
    });
  }
  for (const tool of mcpTools) {
    capabilityRegistry.register({
      kind: 'mcp',
      name: tool.definition.name,
      description: tool.definition.description,
      inputSchema: tool.definition.inputSchema,
    });
  }
  const lspClient = await connectWorkspaceLspServers(pluginRuntime, lspManager, options.cwd, capabilityHealth, disposables);
  const health = createPlatformRuntimeHealth(capabilityHealth);
  healthStore.set(options.cwd, health.snapshot());

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
    capabilityRegistry,
    reminderDefaultTimeZone,
    createReminderApi,
    health,
    async dispose() {
      for (const reminderApi of reminderApis.splice(0)) {
        await reminderApi.dispose();
      }
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
          const payload = input as { agent?: string; prompt?: string; cwd?: string };
          if (!payload.agent || !payload.prompt) {
            return { ok: false, errorMessage: 'invalid background subagent payload' };
          }

          const result = await execute({
            agent: payload.agent,
            prompt: payload.prompt,
            cwd: payload.cwd,
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
  disposables: Array<{ dispose(): void }>,
): Promise<Tool[]> {
  const tools: Tool[] = [];

  for (const server of servers) {
    try {
      // 创建 client 连接
      const connection = await createMcpClientConnection(server.name, server);

      // 列出所有 tools
      const toolsResult = await connection.client.listTools();
      const schemas = toolsResult.tools ?? [];

      // 构建 xiaok Tool 对象
      tools.push(
        ...buildMcpRuntimeTools(
          { name: server.name, command: '' }, // declaration 兼容旧接口
          {
            listTools: async () => schemas,
            callTool: async (name, input) => {
              const result = await connection.client.callTool({ name, arguments: input });
              // 提取文本内容
              const content = result.content as Array<{ type: string; text?: string }> | undefined;
              const text = content
                ?.filter((c): c is { type: 'text'; text: string } => c.type === 'text')
                .map((c) => c.text)
                .join('\n') ?? '';
              return text;
            },
            dispose: connection.dispose,
          },
          schemas,
        ),
      );

      disposables.push(connection);
      capabilityHealth.push({
        kind: 'mcp',
        name: server.name,
        status: 'connected',
        detail: `${schemas.length} tools`,
      });
    } catch (error) {
      capabilityHealth.push({
        kind: 'mcp',
        name: server.name,
        status: 'degraded',
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return tools;
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
