import type { Tool } from '../../types.js';
import { type CustomAgentDef } from '../../ai/agents/loader.js';
import { createBackgroundRunner, type BackgroundJobRecord } from '../agents/background-runner.js';
import { createLspManager } from '../lsp/manager.js';
import { type PlatformPluginRuntimeState } from '../plugins/runtime.js';
import { createSandboxEnforcer } from '../sandbox/enforcer.js';
import { type TeamService } from '../teams/service.js';
import { type WorktreeManager } from '../worktrees/manager.js';
export interface PlatformRuntimeContext {
    pluginRuntime: PlatformPluginRuntimeState;
    customAgents: CustomAgentDef[];
    lspManager: ReturnType<typeof createLspManager>;
    teamService: TeamService;
    sandboxEnforcer: ReturnType<typeof createSandboxEnforcer>;
    worktreeManager: WorktreeManager;
    mcpTools: Tool[];
    health: PlatformRuntimeHealth;
    dispose(): Promise<void>;
    listBackgroundJobs(sessionId: string): BackgroundJobRecord[];
    createBackgroundRunner(execute: (input: {
        agent: string;
        prompt: string;
    }) => Promise<string>, notify?: (job: BackgroundJobRecord) => Promise<void> | void): ReturnType<typeof createBackgroundRunner>;
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
}
export declare function createPlatformRuntimeContext(options: CreatePlatformRuntimeContextOptions): Promise<PlatformRuntimeContext>;
