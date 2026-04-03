import { resolve } from 'path';
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

export function parsePluginManifest(raw: Record<string, unknown>, pluginDir: string): PluginManifest {
  const toResolvedList = (value: unknown): string[] =>
    Array.isArray(value)
      ? value.filter((entry): entry is string => typeof entry === 'string').map((entry) => resolve(pluginDir, entry))
      : [];

  const parseHooks = (value: unknown): Array<PluginManifestHook | string> => {
    if (!Array.isArray(value)) return [];
    return value.map((entry) => {
      if (typeof entry === 'string') return resolve(pluginDir, entry);
      if (entry && typeof entry === 'object') {
        const e = entry as Record<string, unknown>;
        const hook: PluginManifestHook = { command: String(e['command'] ?? '') };
        if (typeof e['type'] === 'string') hook.type = e['type'] as HookType;
        if (typeof e['url'] === 'string') hook.url = e['url'];
        if (typeof e['prompt'] === 'string') hook.prompt = e['prompt'];
        if (Array.isArray(e['events'])) hook.events = e['events'] as HookEventName[];
        if (typeof e['matcher'] === 'string') hook.matcher = e['matcher'];
        if (Array.isArray(e['tools'])) hook.tools = e['tools'] as string[];
        if (typeof e['timeoutMs'] === 'number') hook.timeoutMs = e['timeoutMs'];
        if (typeof e['async'] === 'boolean') hook.async = e['async'];
        if (typeof e['asyncRewake'] === 'boolean') hook.asyncRewake = e['asyncRewake'];
        if (typeof e['once'] === 'boolean') hook.once = e['once'];
        if (typeof e['statusMessage'] === 'string') hook.statusMessage = e['statusMessage'];
        if (e['headers'] && typeof e['headers'] === 'object') hook.headers = e['headers'] as Record<string, string>;
        if (typeof e['model'] === 'string') hook.model = e['model'];
        return hook;
      }
      return String(entry);
    });
  };

  return {
    name: String(raw.name ?? ''),
    version: String(raw.version ?? ''),
    skills: toResolvedList(raw.skills),
    agents: toResolvedList(raw.agents),
    hooks: parseHooks(raw.hooks),
    commands: Array.isArray(raw.commands) ? raw.commands.filter((entry): entry is string => typeof entry === 'string') : [],
    mcpServers: Array.isArray(raw.mcpServers)
      ? raw.mcpServers
          .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object')
          .map((entry) => ({
            name: String(entry.name ?? ''),
            command: String(entry.command ?? ''),
          }))
      : undefined,
    lspServers: Array.isArray(raw.lspServers)
      ? raw.lspServers
          .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object')
          .map((entry) => ({
            name: String(entry.name ?? ''),
            command: String(entry.command ?? ''),
          }))
      : undefined,
  };
}
