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
    const parseMcpServers = (value) => {
        if (!Array.isArray(value))
            return undefined;
        return value
            .filter((entry) => Boolean(entry) && typeof entry === 'object')
            .map((entry, index) => {
            // 必须有 name 和 type
            const name = String(entry.name ?? `plugin-mcp-${index}`);
            const type = entry.type;
            if (!type) {
                throw new Error(`Plugin MCP server "${name}" missing required "type" field`);
            }
            // 根据 type 构建 config
            if (type === 'stdio') {
                return {
                    name,
                    type: 'stdio',
                    command: String(entry.command ?? ''),
                    args: Array.isArray(entry.args) ? entry.args.filter((a) => typeof a === 'string') : undefined,
                    env: entry.env && typeof entry.env === 'object' ? entry.env : undefined,
                };
            }
            if (type === 'sse') {
                return {
                    name,
                    type: 'sse',
                    url: String(entry.url ?? ''),
                    headers: entry.headers && typeof entry.headers === 'object' ? entry.headers : undefined,
                };
            }
            if (type === 'http') {
                return {
                    name,
                    type: 'http',
                    url: String(entry.url ?? ''),
                    headers: entry.headers && typeof entry.headers === 'object' ? entry.headers : undefined,
                };
            }
            if (type === 'ws') {
                return {
                    name,
                    type: 'ws',
                    url: String(entry.url ?? ''),
                };
            }
            throw new Error(`Plugin MCP server "${name}" has invalid type: ${type}`);
        });
    };
    return {
        name: String(raw.name ?? ''),
        version: String(raw.version ?? ''),
        skills: toResolvedList(raw.skills),
        agents: toResolvedList(raw.agents),
        hooks: parseHooks(raw.hooks),
        commands: Array.isArray(raw.commands) ? raw.commands.filter((entry) => typeof entry === 'string') : [],
        mcpServers: parseMcpServers(raw.mcpServers),
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
