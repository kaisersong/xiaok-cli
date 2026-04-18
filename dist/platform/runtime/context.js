import { execFile } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';
import { loadCustomAgents } from '../../ai/agents/loader.js';
import { buildMcpRuntimeTools } from '../../ai/mcp/runtime/tools.js';
import { createBackgroundRunner } from '../agents/background-runner.js';
import { createLspManager } from '../lsp/manager.js';
import { loadPlatformPluginRuntime, connectDeclaredLspServer } from '../plugins/runtime.js';
import { createSandboxEnforcer } from '../sandbox/enforcer.js';
import { createSandboxPolicy } from '../sandbox/policy.js';
import { FileTeamStore } from '../teams/store.js';
import { createTeamService } from '../teams/service.js';
import { createWorktreeManager } from '../worktrees/manager.js';
import { CapabilityRegistry } from './capability-registry.js';
import { FileCapabilityHealthStore } from './health-store.js';
import { loadSettingsMcpServers, loadPluginMcpServers, mergeMcpServerConfigs, } from '../mcp/config.js';
import { createMcpClientConnection } from '../mcp/transport.js';
export async function createPlatformRuntimeContext(options) {
    const pluginRuntime = await loadPlatformPluginRuntime(options.cwd, options.builtinCommands);
    const customAgents = await loadCustomAgents(undefined, options.cwd, pluginRuntime.agentDirs);
    const lspManager = createLspManager();
    const capabilityRegistry = new CapabilityRegistry();
    const capabilityHealth = [];
    const disposables = [];
    const stateRootDir = join(options.cwd, '.xiaok', 'state');
    const healthStore = new FileCapabilityHealthStore(join(stateRootDir, 'capability-health.json'));
    const teamService = createTeamService({ store: new FileTeamStore(join(stateRootDir, 'teams.json')) });
    const sandboxPolicy = createSandboxPolicy({
        pathAllowlist: [options.cwd, join(options.cwd, '.xiaok'), join(options.cwd, '.worktrees')],
        network: 'allow',
    });
    const sandboxEnforcer = createSandboxEnforcer(sandboxPolicy);
    const worktreeManager = createWorktreeManager({
        repoRoot: options.cwd,
        worktreesDir: join(options.cwd, '.worktrees'),
        execGit: async (args) => new Promise((resolve, reject) => {
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
        health,
        async dispose() {
            for (const disposable of disposables.splice(0).reverse()) {
                try {
                    disposable.dispose();
                }
                catch {
                    continue;
                }
            }
        },
        listBackgroundJobs(sessionId) {
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
                    const payload = input;
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
async function connectWorkspaceLspServers(pluginRuntime, lspManager, cwd, capabilityHealth, disposables) {
    const rootUri = pathToFileUri(cwd);
    const openableDocuments = collectLspSeedDocuments(cwd);
    let firstClient;
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
        }
        catch (error) {
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
async function connectWorkspaceMcpServers(servers, capabilityHealth, disposables) {
    const tools = [];
    for (const server of servers) {
        try {
            // 创建 client 连接
            const connection = await createMcpClientConnection(server.name, server);
            // 列出所有 tools
            const toolsResult = await connection.client.listTools();
            const schemas = toolsResult.tools ?? [];
            // 构建 xiaok Tool 对象
            tools.push(...buildMcpRuntimeTools({ name: server.name, command: '' }, // declaration 兼容旧接口
            {
                listTools: async () => schemas,
                callTool: async (name, input) => {
                    const result = await connection.client.callTool({ name, arguments: input });
                    // 提取文本内容
                    const content = result.content;
                    const text = content
                        ?.filter((c) => c.type === 'text')
                        .map((c) => c.text)
                        .join('\n') ?? '';
                    return text;
                },
                dispose: connection.dispose,
            }, schemas));
            disposables.push(connection);
            capabilityHealth.push({
                kind: 'mcp',
                name: server.name,
                status: 'connected',
                detail: `${schemas.length} tools`,
            });
        }
        catch (error) {
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
function collectLspSeedDocuments(cwd) {
    const candidates = ['src/index.ts', 'src/commands/chat.ts', 'src/commands/yzj.ts', 'tsconfig.json']
        .map((relativePath) => join(cwd, relativePath));
    const docs = [];
    for (const filePath of candidates) {
        try {
            const text = readFileSync(filePath, 'utf8');
            docs.push({
                uri: pathToFileUri(filePath),
                languageId: filePath.endsWith('.json') ? 'json' : 'typescript',
                text,
            });
        }
        catch {
            continue;
        }
    }
    return docs;
}
function pathToFileUri(path) {
    return `file://${path.startsWith('/') ? '' : '/'}${path.replace(/\\/g, '/')}`;
}
function createPlatformRuntimeHealth(capabilities) {
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
async function notifyBackgroundTeam(job, teamService) {
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
