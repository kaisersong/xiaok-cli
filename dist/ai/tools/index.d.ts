import type { Tool, ToolDefinition, ToolExecutionContext } from '../../types.js';
import { PermissionManager } from '../permissions/manager.js';
import type { HooksRunner } from '../../runtime/hooks-runner.js';
import type { CapabilityRegistry } from '../../platform/runtime/capability-registry.js';
import { type WorkspaceToolOptions } from './read.js';
export declare function buildToolList(skillTool?: Tool, workspace?: WorkspaceToolOptions, extraTools?: Tool[]): Tool[];
export interface RegistryOptions {
    capabilityRegistry?: CapabilityRegistry;
    permissionManager?: PermissionManager;
    autoMode?: boolean;
    dryRun?: boolean;
    onPrompt?: (toolName: string, input: Record<string, unknown>) => Promise<boolean>;
    hooksRunner?: HooksRunner;
}
export declare class ToolRegistry {
    private tools;
    private deferredTools;
    private canonicalToolNames;
    private permissionManager;
    private options;
    private allowedToolsFilter;
    setAllowedTools(names: string[] | null): void;
    constructor(options: RegistryOptions, tools?: Tool[]);
    getToolDefinitions(): ToolDefinition[];
    registerTool(tool: Tool): void;
    registerDeferredTool(definition: ToolDefinition): void;
    registerDeferredTools(definitions: ToolDefinition[]): void;
    searchDeferredTools(query: string): ToolDefinition[];
    searchTools(query: string): ToolDefinition[];
    executeTool(name: string, rawInput: Record<string, unknown>, context?: ToolExecutionContext): Promise<string>;
    /** 用户输入 y! 后，切换当前 registry 为 auto 模式 */
    enableAutoMode(): void;
}
