import type { ModelAdapter, Tool } from '../../types.js';
import { ToolRegistry } from '../../ai/tools/index.js';
import type { PlatformRuntimeContext } from './context.js';
export interface PlatformRegistryFactoryOptions {
    platform: PlatformRuntimeContext;
    source: string;
    sessionId: string;
    transcriptPath?: string;
    adapter: () => ModelAdapter;
    skillTool?: Tool;
    workflowTools?: Tool[];
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
}
export interface PlatformRegistryFactory {
    createRegistry(cwd: string, allowedTools?: string[]): ToolRegistry;
}
export declare function createPlatformRegistryFactory(options: PlatformRegistryFactoryOptions): PlatformRegistryFactory;
