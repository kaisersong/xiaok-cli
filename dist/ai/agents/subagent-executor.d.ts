import { type DelegatedObservationExecutionPlan } from '../../runtime/sol-pi/delegated-session-owner.js';
import { type ObservationSessionOwner } from '../../runtime/sol-pi/observation-session-owner.js';
import { type SubAgentProgressEvent } from './subagent-presentation.js';
import type { CustomAgentDef } from './loader.js';
import type { ModelAdapter, ToolExecutionContext } from '../../types.js';
import type { ToolRegistry } from '../tools/index.js';
import type { WorktreeAllocationRecord } from '../../platform/worktrees/manager.js';
import type { WorktreeManager } from '../../platform/worktrees/manager.js';
import { type ManagedAgentRunContext } from './multi-agent-coordinator.js';
/** Fork consumption only; not a host-context or authorization producer. */
type SubAgentForkControls = Pick<ToolExecutionContext, 'signal' | 'settingsStore'>;
type SubAgentForkHistory = Pick<ToolExecutionContext, 'session' | 'messages'>;
/** Full snapshots retain their protected closure; history fields are paired.
 * A signal in forkContext is consumed by the one-shot wrapper only.
 * Preserve the complete host shape for existing inline callers without weakening it.
 */
export type SubAgentForkContext = ToolExecutionContext | (SubAgentForkControls & (SubAgentForkHistory | {
    session?: undefined;
    messages?: undefined;
}));
export interface ExecuteNamedSubAgentOptions {
    observationExecutionPlan?: DelegatedObservationExecutionPlan;
    onSubAgentEvent?: (event: SubAgentProgressEvent) => void;
    onCompleted?: () => void;
    onObservationOwnerReady?: (owner: ObservationSessionOwner) => void;
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
    forkContext?: SubAgentForkContext;
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
export {};
