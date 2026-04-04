export type HookEventName = 'PreToolUse' | 'PostToolUse' | 'PostToolUseFailure' | 'PermissionRequest' | 'PermissionDenied' | 'Notification' | 'UserPromptSubmit' | 'SessionStart' | 'SessionEnd' | 'Stop' | 'StopFailure' | 'SubagentStart' | 'SubagentStop' | 'PreCompact' | 'PostCompact' | 'Setup' | 'TaskCreated' | 'TaskCompleted' | 'WorktreeCreate' | 'WorktreeRemove' | 'FileChanged';
export interface HookSharedContext {
    session_id: string;
    cwd: string;
    transcript_path?: string;
    agent_id?: string;
    agent_type?: string;
}
export type HookType = 'command' | 'http' | 'prompt';
export interface HookConfigBase {
    /** Hook type. Defaults to 'command'. */
    type?: HookType;
    /** Which hook events this hook responds to. Omit to match ALL events. */
    events?: HookEventName[];
    /**
     * Matcher for the per-event query field.
     * - For tool events: matches tool_name
     * - For SessionStart: matches source
     * - For Notification: matches notification_type
     * Supports: exact string, pipe-separated OR ('Bash|Edit'), /regex/flags, '*' wildcard.
     * Omit to match all.
     */
    matcher?: string;
    /**
     * @deprecated Use matcher. Tool name filter for tool-related events only.
     * Kept for backward compat.
     */
    tools?: string[];
    /** Timeout in milliseconds. Defaults to 10000. */
    timeoutMs?: number;
    /** If true, run in background (non-blocking). Defaults to false. */
    async?: boolean;
    /**
     * If true AND async is true, exit code 2 from background hook
     * re-wakes the model. Defaults to false.
     */
    asyncRewake?: boolean;
    /** If true, run only once per session. Defaults to false. */
    once?: boolean;
    /** Status message shown while hook is running. */
    statusMessage?: string;
}
export interface CommandHookConfig extends HookConfigBase {
    type?: 'command';
    /** Shell command to execute */
    command: string;
    /** Shell to use. Defaults to system shell. */
    shell?: string;
}
export interface HttpHookConfig extends HookConfigBase {
    type: 'http';
    /** URL to POST the payload to */
    url: string;
    /** Extra HTTP headers */
    headers?: Record<string, string>;
}
export interface PromptHookConfig extends HookConfigBase {
    type: 'prompt';
    /** LLM prompt text. Use $ARGUMENTS as placeholder for JSON payload. */
    prompt: string;
    /** Model to use for the LLM call. */
    model?: string;
}
export type HookConfig = CommandHookConfig | HttpHookConfig | PromptHookConfig;
/** Legacy format — plain command strings */
export type HookConfigOrCommand = HookConfig | string;
export interface HooksRunnerConfig {
    hooks?: HookConfigOrCommand[];
    /** Backward-compat: plain pre-hook commands */
    pre?: Array<{
        command: string;
        tools?: string[];
    }>;
    /** Backward-compat: plain post-hook commands */
    post?: Array<{
        command: string;
        tools?: string[];
    }>;
    /** Default timeout in ms if not specified per-hook */
    timeoutMs?: number;
    /** Shared context injected into all hook payloads */
    context?: Partial<HookSharedContext>;
    /** Callback for prompt-type hooks (sends prompt to LLM, returns response) */
    promptExecutor?: (prompt: string, model?: string) => Promise<string>;
    /** Callback invoked when an asyncRewake hook completes with exit code 2 */
    onAsyncRewake?: (eventName: HookEventName, payload: Record<string, unknown>) => void;
}
export interface HookRunResult {
    ok: boolean;
    message?: string;
    /** PreToolUse: modified tool input to pass to the tool */
    updatedInput?: Record<string, unknown>;
    /** PreToolUse: if true, abort the tool call */
    preventContinuation?: boolean;
    /** Additional context text to prepend to the tool result */
    additionalContext?: string;
    /** Permission decision — 'allow' or 'deny' (for PermissionRequest hooks) */
    decision?: 'allow' | 'deny';
    /** Whether the hook ran asynchronously (fire-and-forget) */
    async?: boolean;
}
export interface HooksRunner {
    /** Run hooks registered for a specific event. */
    runHooks(eventName: HookEventName, payload: Record<string, unknown>): Promise<HookRunResult>;
    /** Convenience: run PreToolUse hooks */
    runPreHooks(toolName: string, input: Record<string, unknown>): Promise<HookRunResult>;
    /** Convenience: run PostToolUse hooks */
    runPostHooks(toolName: string, input: Record<string, unknown>): Promise<string[]>;
}
export declare function createHooksRunner(config?: HooksRunnerConfig): HooksRunner;
