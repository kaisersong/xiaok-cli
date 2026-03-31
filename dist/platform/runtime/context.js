import { execFile } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';
import { loadCustomAgents } from '../../ai/agents/loader.js';
import { buildMcpRuntimeTools } from '../../ai/mcp/runtime/tools.js';
import { createBackgroundRunner } from '../agents/background-runner.js';
import { createLspManager } from '../lsp/manager.js';
import { loadPlatformPluginRuntime, connectDeclaredMcpServer, connectDeclaredLspServer } from '../plugins/runtime.js';
import { createSandboxEnforcer } from '../sandbox/enforcer.js';
import { createSandboxPolicy } from '../sandbox/policy.js';
import { FileTeamStore } from '../teams/store.js';
import { createTeamService } from '../teams/service.js';
import { createWorktreeManager } from '../worktrees/manager.js';
import { FileCapabilityHealthStore } from './health-store.js';
export async function createPlatformRuntimeContext(options) {
    const pluginRuntime = await loadPlatformPluginRuntime(options.cwd, options.builtinCommands);
    const customAgents = await loadCustomAgents(undefined, options.cwd, pluginRuntime.agentDirs);
    const lspManager = createLspManager();
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
    const mcpTools = await connectWorkspaceMcpServers(pluginRuntime, capabilityHealth, disposables);
    await connectWorkspaceLspServers(pluginRuntime, lspManager, options.cwd, capabilityHealth, disposables);
    const health = createPlatformRuntimeHealth(capabilityHealth);
    healthStore.set(options.cwd, health.snapshot());
    return {
        pluginRuntime,
        customAgents,
        lspManager,
        teamService,
        sandboxEnforcer,
        worktreeManager,
        mcpTools,
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
                    });
                    return { ok: true, summary: result.slice(0, 200) };
                },
                notify,
            });
        },
    };
}
async function connectWorkspaceLspServers(pluginRuntime, lspManager, cwd, capabilityHealth, disposables) {
    const rootUri = pathToFileUri(cwd);
    const openableDocuments = collectLspSeedDocuments(cwd);
    for (const declaration of pluginRuntime.lspServers) {
        try {
            const connection = await connectDeclaredLspServer(declaration, lspManager, rootUri);
            for (const document of openableDocuments) {
                await connection.didOpenDocument(document);
            }
            disposables.push(connection);
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
}
async function connectWorkspaceMcpServers(pluginRuntime, capabilityHealth, disposables) {
    const tools = [];
    for (const declaration of pluginRuntime.mcpServers) {
        try {
            const client = await connectDeclaredMcpServer(declaration);
            const schemas = await client.listTools();
            tools.push(...buildMcpRuntimeTools(declaration, client, schemas));
            disposables.push(client);
            capabilityHealth.push({
                kind: 'mcp',
                name: declaration.name,
                status: 'connected',
                detail: `${schemas.length} tools`,
            });
        }
        catch (error) {
            capabilityHealth.push({
                kind: 'mcp',
                name: declaration.name,
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
