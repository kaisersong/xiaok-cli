import type { ModelAdapter, Tool } from '../../types.js';
import type { SubAgentProgressEvent } from '../../ai/agents/subagent-presentation.js';
import { ToolRegistry, type ToolObservation } from '../../ai/tools/index.js';
import { type MultiAgentEvent } from '../../ai/agents/multi-agent-coordinator.js';
import type { ReminderApi } from '../../runtime/reminder/service.js';
import type { PlatformRuntimeContext } from './context.js';
export declare function filterWorkflowToolsForAgent(tools: Tool[], agentId: string): Tool[];
export interface PlatformRegistryFactoryOptions {
    notifyReminder?: (message: string) => void;
    runInteractiveBash?: Tool['execute'];
    onSubAgentEvent?: (event: SubAgentProgressEvent) => void;
    onMultiAgentEvent?: (event: MultiAgentEvent) => void;
    platform: PlatformRuntimeContext;
    source: string;
    sessionId: string;
    transcriptPath?: string;
    adapter: () => ModelAdapter;
    skillTool?: Tool;
    workflowTools?: Tool[];
    memoryStore?: import('../../ai/memory/store.js').MemoryStore;
    dryRun?: boolean;
    permissionManager?: ConstructorParameters<typeof ToolRegistry>[0]['permissionManager'];
    onPrompt?: (toolName: string, input: Record<string, unknown>) => Promise<boolean>;
    onSandboxDenied?: (deniedPath: string, toolName: string) => Promise<{
        shouldProceed: boolean;
    }> | {
        shouldProceed: boolean;
    };
    buildSystemPrompt(cwd: string): Promise<string>;
    notifyBackgroundJob?: Parameters<PlatformRuntimeContext['createBackgroundRunner']>[1];
    getCurrentTaskId?: () => string | undefined;
    onToolObserved?: (event: ToolObservation) => Promise<void> | void;
}
export interface PlatformRegistryFactory {
    createRegistry(cwd: string, allowedTools?: string[], agentId?: string, opts?: {
        parentDepth?: number;
    }): ToolRegistry;
    getReminderApi(): ReminderApi | undefined;
    dispose(): Promise<void>;
}
export declare function createPlatformRegistryFactory(options: PlatformRegistryFactoryOptions): PlatformRegistryFactory;
