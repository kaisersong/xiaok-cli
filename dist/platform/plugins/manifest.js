import { resolve } from 'path';
export function parsePluginManifest(raw, pluginDir) {
    const toResolvedList = (value) => Array.isArray(value)
        ? value.filter((entry) => typeof entry === 'string').map((entry) => resolve(pluginDir, entry))
        : [];
    return {
        name: String(raw.name ?? ''),
        version: String(raw.version ?? ''),
        skills: toResolvedList(raw.skills),
        agents: toResolvedList(raw.agents),
        hooks: toResolvedList(raw.hooks),
        commands: Array.isArray(raw.commands) ? raw.commands.filter((entry) => typeof entry === 'string') : [],
        mcpServers: Array.isArray(raw.mcpServers)
            ? raw.mcpServers
                .filter((entry) => Boolean(entry) && typeof entry === 'object')
                .map((entry) => ({
                name: String(entry.name ?? ''),
                command: String(entry.command ?? ''),
            }))
            : undefined,
        lspServers: Array.isArray(raw.lspServers)
            ? raw.lspServers
                .filter((entry) => Boolean(entry) && typeof entry === 'object')
                .map((entry) => ({
                name: String(entry.name ?? ''),
                command: String(entry.command ?? ''),
            }))
            : undefined,
    };
}
