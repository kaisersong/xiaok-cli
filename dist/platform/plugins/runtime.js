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
            args: ['/d', '/s', '/c', command],
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
    return {
        plugins,
        skillRoots: plugins.flatMap((plugin) => plugin.skills),
        agentDirs: plugins.flatMap((plugin) => plugin.agents),
        hookCommands: plugins.flatMap((plugin) => plugin.hooks),
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
        dispose: () => client.dispose(),
    };
}
