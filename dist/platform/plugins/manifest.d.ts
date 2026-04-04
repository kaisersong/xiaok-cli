import type { HookEventName, HookType } from '../../runtime/hooks-runner.js';
export interface PluginManifestServer {
    name: string;
    command: string;
}
/** Structured hook entry in plugin.json */
export interface PluginManifestHook {
    /** Hook type: 'command' (default), 'http', or 'prompt' */
    type?: HookType;
    /** Shell command (type=command) or URL (type=http) or LLM prompt (type=prompt) */
    command: string;
    /** URL for http hooks */
    url?: string;
    /** LLM prompt text for prompt hooks */
    prompt?: string;
    /** Hook event types this hook responds to. Omit to match all events. */
    events?: HookEventName[];
    /** Matcher string: exact, pipe-separated OR, regex, or '*'. */
    matcher?: string;
    /** @deprecated Use matcher. Tool name filter for tool-related events. */
    tools?: string[];
    /** Timeout in ms. Defaults to 10000. */
    timeoutMs?: number;
    /** Run in background (non-blocking). */
    async?: boolean;
    /** Re-wake model if background hook exits with code 2. */
    asyncRewake?: boolean;
    /** Run only once per session. */
    once?: boolean;
    /** Status message while running. */
    statusMessage?: string;
    /** Extra HTTP headers (type=http only). */
    headers?: Record<string, string>;
    /** LLM model (type=prompt only). */
    model?: string;
}
export interface PluginManifest {
    name: string;
    version: string;
    skills: string[];
    agents: string[];
    /** Structured hook configs or legacy plain command strings */
    hooks: Array<PluginManifestHook | string>;
    commands: string[];
    mcpServers?: PluginManifestServer[];
    lspServers?: PluginManifestServer[];
}
export declare function parsePluginManifest(raw: Record<string, unknown>, pluginDir: string): PluginManifest;
