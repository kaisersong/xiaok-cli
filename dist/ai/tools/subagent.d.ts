import type { Tool, ModelAdapter } from '../../types.js';
import type { CustomAgentDef } from '../agents/loader.js';
import type { ToolRegistry } from './index.js';
import type { BackgroundRunner } from '../../platform/agents/background-runner.js';
import type { WorktreeManager } from '../../platform/worktrees/manager.js';
import type { SubAgentProgressEvent } from '../agents/subagent-presentation.js';
export interface CreateRegistryOptions {
    parentDepth?: number;
}
interface SubAgentToolOptions {
    onSubAgentEvent?: (event: SubAgentProgressEvent) => void;
    source: string;
    sessionId: string;
    cwd?: string;
    adapter: () => ModelAdapter;
    agents: CustomAgentDef[];
    createRegistry(cwd: string, allowedTools?: string[], agentId?: string, opts?: CreateRegistryOptions): ToolRegistry;
    releaseRegistry?: (registry: ToolRegistry) => void | Promise<void>;
    buildSystemPrompt(cwd: string): Promise<string>;
    backgroundRunner?: BackgroundRunner;
    worktreeManager?: WorktreeManager;
    getTaskId?: () => string | undefined;
    parentDepth?: number;
    maxDepth?: number;
}
export declare function createSubAgentTool(options: SubAgentToolOptions): Tool;
export {};
