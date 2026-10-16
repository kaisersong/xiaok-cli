import { resolve, posix, win32 } from 'path';
function resolvePluginMcpArgument(arg, pluginDir) {
    if (arg.startsWith('-') || posix.isAbsolute(arg) || win32.isAbsolute(arg)
        || /^[a-z][a-z0-9+.-]*:/i.test(arg) || arg.startsWith('~'))
        return arg;
    const relativeFile = /[\\/]/.test(arg) || /\.(?:[cm]?js|py)$/i.test(arg);
    return relativeFile ? resolve(pluginDir, arg) : arg;
}
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
            const buildBase = () => {
                if (type === 'stdio') {
                    const rawArgs = Array.isArray(entry.args) ? entry.args.filter((a) => typeof a === 'string') : undefined;
                    // Bare subcommands/values are not files. Keep bundled script paths
                    // relative to the plugin while preserving flags, URIs and absolute paths.
                    const resolvedArgs = rawArgs?.map((arg) => resolvePluginMcpArgument(arg, pluginDir));
                    return {
                        name,
                        type: 'stdio',
                        command: String(entry.command ?? ''),
                        args: resolvedArgs,
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
            };
            const base = buildBase();
            if (entry.protocol !== undefined) {
                if (!entry.protocol || typeof entry.protocol !== 'object') {
                    throw new Error(`Plugin MCP server "${name}" has invalid protocol policy`);
                }
                const rawProtocol = entry.protocol;
                if (rawProtocol.mode === 'auto' || rawProtocol.mode === 'legacy') {
                    base.protocol = { mode: rawProtocol.mode };
                }
                else if (rawProtocol.mode === 'modern') {
                    if (rawProtocol.version !== '2026-07-28') {
                        throw new Error(`Plugin MCP server "${name}" modern protocol policy requires version "2026-07-28"`);
                    }
                    base.protocol = {
                        mode: 'modern',
                        version: rawProtocol.version,
                    };
                }
                else {
                    throw new Error(`Plugin MCP server "${name}" has invalid protocol policy`);
                }
            }
            if (entry.timeout && typeof entry.timeout === 'object') {
                const rawTimeout = entry.timeout;
                const timeout = {};
                for (const key of ['startup', 'catalog', 'call', 'resource']) {
                    const timeoutValue = rawTimeout[key];
                    if (typeof timeoutValue === 'number' && Number.isFinite(timeoutValue) && timeoutValue > 0) {
                        timeout[key] = timeoutValue;
                    }
                }
                if (Object.keys(timeout).length > 0)
                    base.timeout = timeout;
            }
            if (entry.requiresUserActivation === true) {
                base.requiresUserActivation = true;
            }
            return base;
        });
    };
    return {
        name: String(raw.name ?? ''),
        version: String(raw.version ?? ''),
        platforms: Array.isArray(raw.platforms)
            ? raw.platforms.filter((entry) => typeof entry === 'string')
            : undefined,
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
