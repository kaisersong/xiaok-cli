import type { Tool, ToolDefinition } from '../../types.js';
export declare function buildToolList(skillTool?: Tool): Tool[];
export interface RegistryOptions {
    autoMode: boolean;
    dryRun: boolean;
    onPrompt: (toolName: string, input: Record<string, unknown>) => Promise<boolean>;
}
export declare class ToolRegistry {
    private tools;
    private options;
    constructor(options: RegistryOptions, tools?: Tool[]);
    getToolDefinitions(): ToolDefinition[];
    executeTool(name: string, input: Record<string, unknown>): Promise<string>;
    /** 用户输入 y! 后，切换当前 registry 为 auto 模式 */
    enableAutoMode(): void;
}
