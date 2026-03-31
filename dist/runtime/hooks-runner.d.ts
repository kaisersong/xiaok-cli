export interface ToolHookConfig {
    command: string;
    tools?: string[];
}
export interface HooksRunnerConfig {
    pre?: ToolHookConfig[];
    post?: ToolHookConfig[];
    timeoutMs?: number;
}
export interface HookRunResult {
    ok: boolean;
    message?: string;
}
export interface HooksRunner {
    runPreHooks(toolName: string, input: Record<string, unknown>): Promise<HookRunResult>;
    runPostHooks(toolName: string, input: Record<string, unknown>): Promise<string[]>;
}
export declare function createHooksRunner(config?: HooksRunnerConfig): HooksRunner;
