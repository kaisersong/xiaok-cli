import type { CustomAgentDef } from './loader.js';
import type { ModelAdapter } from '../../types.js';
import type { ToolRegistry } from '../tools/index.js';
import type { WorktreeManager } from '../../platform/worktrees/manager.js';
export interface ExecuteNamedSubAgentOptions {
    agentDef: CustomAgentDef;
    prompt: string;
    sessionId: string;
    adapter: () => ModelAdapter;
    createRegistry(cwd: string, allowedTools?: string[]): ToolRegistry;
    buildSystemPrompt(cwd: string): Promise<string>;
    worktreeManager?: WorktreeManager;
}
export declare function executeNamedSubAgent(options: ExecuteNamedSubAgentOptions): Promise<string>;
export declare function resolveSubAgentCwd(manager: WorktreeManager | undefined, agent: CustomAgentDef, sessionId: string): Promise<string>;
