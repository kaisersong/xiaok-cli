import { resolve } from 'path';

export interface PluginManifestServer {
  name: string;
  command: string;
}

export interface PluginManifest {
  name: string;
  version: string;
  skills: string[];
  agents: string[];
  hooks: string[];
  commands: string[];
  mcpServers?: PluginManifestServer[];
}

export function parsePluginManifest(raw: Record<string, unknown>, pluginDir: string): PluginManifest {
  const toResolvedList = (value: unknown): string[] =>
    Array.isArray(value)
      ? value.filter((entry): entry is string => typeof entry === 'string').map((entry) => resolve(pluginDir, entry))
      : [];

  return {
    name: String(raw.name ?? ''),
    version: String(raw.version ?? ''),
    skills: toResolvedList(raw.skills),
    agents: toResolvedList(raw.agents),
    hooks: toResolvedList(raw.hooks),
    commands: Array.isArray(raw.commands) ? raw.commands.filter((entry): entry is string => typeof entry === 'string') : [],
    mcpServers: Array.isArray(raw.mcpServers)
      ? raw.mcpServers
          .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object')
          .map((entry) => ({
            name: String(entry.name ?? ''),
            command: String(entry.command ?? ''),
          }))
      : undefined,
  };
}
