import type { CustomAgentDef } from './loader.js';
import type { ModelAdapter, ToolExecutionContext } from '../../types.js';
import type { ToolRegistry } from '../tools/index.js';
import type { WorktreeAllocationRecord } from '../../platform/worktrees/manager.js';
import type { WorktreeManager } from '../../platform/worktrees/manager.js';
export interface ExecuteNamedSubAgentOptions {
    agentDef: CustomAgentDef;
    prompt: string;
    sessionId: string;
    cwd?: string;
    adapter: () => ModelAdapter;
    createRegistry(cwd: string, allowedTools?: string[], agentId?: string): ToolRegistry;
    buildSystemPrompt(cwd: string): Promise<string>;
    worktreeManager?: WorktreeManager;
    forkContext?: ToolExecutionContext;
}
export declare function executeNamedSubAgent(options: ExecuteNamedSubAgentOptions): Promise<string>;
export declare function resolveSubAgentCwd(manager: WorktreeManager | undefined, agent: CustomAgentDef, sessionId: string, cwd?: string): Promise<{
    cwd: string;
    allocation?: WorktreeAllocationRecord;
}>;
