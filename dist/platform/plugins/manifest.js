import { resolve } from 'path';
export function parsePluginManifest(raw, pluginDir) {
    const toResolvedList = (value) => Array.isArray(value)
        ? value.filter((entry) => typeof entry === 'string').map((entry) => resolve(pluginDir, entry))
        : [];
    const parseHooks = (value) => {
        if (!Array.isArray(value))
            return [];
        return value.map((entry) => {
            if (typeof entry === 'string')
                return resolve(pluginDir, entry);
            if (entry && typeof entry === 'object') {
                const e = entry;
                const hook = { command: String(e['command'] ?? '') };
                if (typeof e['type'] === 'string')
                    hook.type = e['type'];
                if (typeof e['url'] === 'string')
                    hook.url = e['url'];
                if (typeof e['prompt'] === 'string')
                    hook.prompt = e['prompt'];
                if (Array.isArray(e['events']))
                    hook.events = e['events'];
                if (typeof e['matcher'] === 'string')
                    hook.matcher = e['matcher'];
                if (Array.isArray(e['tools']))
                    hook.tools = e['tools'];
                if (typeof e['timeoutMs'] === 'number')
                    hook.timeoutMs = e['timeoutMs'];
                if (typeof e['async'] === 'boolean')
                    hook.async = e['async'];
                if (typeof e['asyncRewake'] === 'boolean')
                    hook.asyncRewake = e['asyncRewake'];
                if (typeof e['once'] === 'boolean')
                    hook.once = e['once'];
                if (typeof e['statusMessage'] === 'string')
                    hook.statusMessage = e['statusMessage'];
                if (e['headers'] && typeof e['headers'] === 'object')
                    hook.headers = e['headers'];
                if (typeof e['model'] === 'string')
                    hook.model = e['model'];
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
