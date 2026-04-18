import { homedir } from 'os';
import { join } from 'path';
import { createMcpRuntimeClient } from '../../ai/mcp/runtime/client.js';
import { createStdioMcpTransport, startMcpServerProcess } from '../../ai/mcp/runtime/server-process.js';
import { createLspClient } from '../lsp/client.js';
import { createStdioLspTransport, startLspServerProcess } from '../lsp/server-process.js';
import { loadPlugins } from './loader.js';
export function resolvePluginShellCommand(command, platform = process.platform) {
    if (platform === 'win32') {
        return {
            command: 'cmd.exe',
            // Wrap the full command so cmd.exe preserves quoted executables like
            // "C:\Program Files\nodejs\node.exe" when we pass arguments verbatim.
            args: ['/d', '/s', '/c', `"${command}"`],
        };
    }
    return {
        command: 'sh',
        args: ['-c', command],
    };
}
export async function loadPlatformPluginRuntime(cwd, builtinCommands) {
    const pluginDirs = [
        join(homedir(), '.xiaok', 'plugins'),
        join(cwd, '.xiaok', 'plugins'),
    ];
    const plugins = await loadPlugins(pluginDirs, { builtinCommands });
    const rawHooks = plugins.flatMap((plugin) => plugin.hooks);
    const hookConfigs = rawHooks.map((h) => {
        if (typeof h === 'string')
            return h;
        // Convert PluginManifestHook to the appropriate HookConfig variant
        if (h.type === 'http' && h.url) {
            return { type: 'http', url: h.url, events: h.events, matcher: h.matcher, tools: h.tools, timeoutMs: h.timeoutMs, async: h.async, asyncRewake: h.asyncRewake, once: h.once, statusMessage: h.statusMessage, headers: h.headers };
        }
        if (h.type === 'prompt' && h.prompt) {
            return { type: 'prompt', prompt: h.prompt, events: h.events, matcher: h.matcher, tools: h.tools, timeoutMs: h.timeoutMs, async: h.async, asyncRewake: h.asyncRewake, once: h.once, statusMessage: h.statusMessage, model: h.model };
        }
        return { type: 'command', command: h.command, events: h.events, matcher: h.matcher, tools: h.tools, timeoutMs: h.timeoutMs, async: h.async, asyncRewake: h.asyncRewake, once: h.once, statusMessage: h.statusMessage };
    });
    const hookCommands = rawHooks.map((h) => typeof h === 'string' ? h : h.command);
    return {
        plugins,
        skillRoots: plugins.flatMap((plugin) => plugin.skills),
        agentDirs: plugins.flatMap((plugin) => plugin.agents),
        hookConfigs,
        hookCommands,
        commandDeclarations: plugins.flatMap((plugin) => plugin.commands),
        mcpServers: plugins.flatMap((plugin) => plugin.mcpServers ?? []),
        lspServers: plugins.flatMap((plugin) => plugin.lspServers ?? []),
    };
}
export async function connectDeclaredMcpServer(declaration) {
    const shell = resolvePluginShellCommand(declaration.command);
    const processHandle = startMcpServerProcess(shell.command, shell.args);
    const transport = createStdioMcpTransport(processHandle.child);
    const client = createMcpRuntimeClient(transport);
    try {
        await client.initialize();
    }
    catch (error) {
        transport.dispose();
        processHandle.dispose();
        throw error;
    }
    return {
        listTools: () => client.listTools(),
        callTool: (name, input) => client.callTool(name, input),
        dispose: () => {
            transport.dispose();
            processHandle.dispose();
        },
    };
}
export async function connectDeclaredLspServer(declaration, manager, rootUri) {
    const shell = resolvePluginShellCommand(declaration.command);
    const processHandle = startLspServerProcess(shell.command, shell.args);
    const transport = createStdioLspTransport(processHandle.child);
    const client = createLspClient(transport, manager);
    try {
        await client.initialize(rootUri);
    }
    catch (error) {
        client.dispose();
        throw error;
    }
    return {
        didOpenDocument: (document) => client.didOpenDocument(document),
        goToDefinition: (uri, line, character) => client.goToDefinition(uri, line, character),
        findReferences: (uri, line, character) => client.findReferences(uri, line, character),
        hover: (uri, line, character) => client.hover(uri, line, character),
        documentSymbols: (uri) => client.documentSymbols(uri),
        dispose: () => client.dispose(),
    };
}
