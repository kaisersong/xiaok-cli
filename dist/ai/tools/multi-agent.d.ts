import type { Tool, ToolExecutionContext } from '../../types.js';
import type { CustomAgentDef } from '../agents/loader.js';
import type { AgentIdentity, ManagedAgentSession, MultiAgentCoordinator } from '../agents/multi-agent-coordinator.js';
export declare const MULTI_AGENT_TOOL_NAMES: readonly ["spawn_agent", "send_message", "followup_task", "wait_agent", "list_agents", "interrupt_agent", "close_agent"];
export declare const CHILD_COMMUNICATION_TOOL_NAMES: Set<string>;
export interface CreateMultiAgentSessionInput {
    agentDef: CustomAgentDef;
    taskDescription?: string;
    identity: AgentIdentity;
    signal: AbortSignal;
    forkContext?: ToolExecutionContext;
}
export interface CreateMultiAgentToolsOptions {
    coordinator: MultiAgentCoordinator;
    callerId: string;
    agents: CustomAgentDef[];
    createSession(input: CreateMultiAgentSessionInput): Promise<ManagedAgentSession>;
}
export declare function createMultiAgentTools(options: CreateMultiAgentToolsOptions): Tool[];
