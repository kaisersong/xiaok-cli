import { resolve } from 'path';
import type { HookEventName } from '../../runtime/hooks-runner.js';

export interface PluginManifestServer {
  name: string;
  command: string;
}

/** Structured hook entry in plugin.json */
export interface PluginManifestHook {
  command: string;
  /** Hook event types this hook responds to. Omit to match all events. */
  events?: HookEventName[];
  /** Tool name filter (for tool-related events). Supports '*' and /regex/. Omit to match all tools. */
  tools?: string[];
  /** Timeout in ms. Defaults to 10000. */
  timeoutMs?: number;
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
        if (Array.isArray(e['events'])) hook.events = e['events'] as HookEventName[];
        if (Array.isArray(e['tools'])) hook.tools = e['tools'] as string[];
        if (typeof e['timeoutMs'] === 'number') hook.timeoutMs = e['timeoutMs'];
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
