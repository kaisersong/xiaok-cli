import type { Tool, ModelAdapter } from '../../types.js';
import type { CustomAgentDef } from '../agents/loader.js';
import type { ToolRegistry } from './index.js';
import type { BackgroundRunner } from '../../platform/agents/background-runner.js';
import type { WorktreeManager } from '../../platform/worktrees/manager.js';
interface SubAgentToolOptions {
    source: string;
    sessionId: string;
    adapter: () => ModelAdapter;
    agents: CustomAgentDef[];
    createRegistry(cwd: string, allowedTools?: string[]): ToolRegistry;
    buildSystemPrompt(cwd: string): Promise<string>;
    backgroundRunner?: BackgroundRunner;
    worktreeManager?: WorktreeManager;
    getTaskId?: () => string | undefined;
}
export declare function createSubAgentTool(options: SubAgentToolOptions): Tool;
export {};
