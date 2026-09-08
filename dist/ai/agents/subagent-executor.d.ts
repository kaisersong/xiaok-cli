import { type SubAgentProgressEvent } from './subagent-presentation.js';
import type { CustomAgentDef } from './loader.js';
import type { ModelAdapter, ToolExecutionContext } from '../../types.js';
import type { ToolRegistry } from '../tools/index.js';
import type { WorktreeAllocationRecord } from '../../platform/worktrees/manager.js';
import type { WorktreeManager } from '../../platform/worktrees/manager.js';
import { type ManagedAgentRunContext } from './multi-agent-coordinator.js';
export interface ExecuteNamedSubAgentOptions {
    onSubAgentEvent?: (event: SubAgentProgressEvent) => void;
    taskDescription?: string;
    agentDef: CustomAgentDef;
    prompt: string;
    sessionId: string;
    cwd?: string;
    adapter: () => ModelAdapter;
    createRegistry(cwd: string, allowedTools?: string[], agentId?: string, opts?: {
        parentDepth?: number;
    }): ToolRegistry;
    buildSystemPrompt(cwd: string): Promise<string>;
    worktreeManager?: WorktreeManager;
    forkContext?: ToolExecutionContext;
    parentDepth?: number;
    runtimeAgentId?: string;
    collaborationPrompt?: string;
    releaseRegistry?: (registry: ToolRegistry) => void | Promise<void>;
    signal?: AbortSignal;
}
export interface NamedSubAgentSession {
    run(prompt: string, signal?: AbortSignal, context?: ManagedAgentRunContext): Promise<string>;
    suspend(): Promise<void>;
    deactivate(): Promise<void>;
    dispose(): Promise<void>;
}
export declare function createNamedSubAgentSession(options: Omit<ExecuteNamedSubAgentOptions, 'prompt'>): Promise<NamedSubAgentSession>;
export declare function executeNamedSubAgent(options: ExecuteNamedSubAgentOptions): Promise<string>;
export declare function resolveSubAgentCwd(manager: WorktreeManager | undefined, agent: CustomAgentDef, sessionId: string, cwd?: string, runtimeAgentId?: string): Promise<{
    cwd: string;
    allocation?: WorktreeAllocationRecord;
}>;
