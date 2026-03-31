import { homedir } from 'os';
import { join } from 'path';
import { createInterface } from 'readline';
import { createMcpRuntimeClient } from '../../ai/mcp/runtime/client.js';
import { startMcpServerProcess } from '../../ai/mcp/runtime/server-process.js';
import { createLspClient, decodeLspFrames } from '../lsp/client.js';
import { startLspServerProcess } from '../lsp/server-process.js';
import { loadPlugins } from './loader.js';
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
    const processHandle = startMcpServerProcess('sh', ['-c', declaration.command]);
    const transport = createLineDelimitedMcpTransport(processHandle.child);
    const client = createMcpRuntimeClient(transport);
    await client.initialize();
    return {
        listTools: () => client.listTools(),
        callTool: (name, input) => client.callTool(name, input),
        dispose: () => processHandle.dispose(),
    };
}
export async function connectDeclaredLspServer(declaration, manager, rootUri) {
    const processHandle = startLspServerProcess('sh', ['-c', declaration.command]);
    const transport = createStdioLspTransport(processHandle.child);
    const client = createLspClient(transport, manager);
    await client.initialize(rootUri);
    return {
        didOpenDocument: (document) => client.didOpenDocument(document),
        dispose: () => client.dispose(),
    };
}
function createLineDelimitedMcpTransport(child) {
    const rl = createInterface({ input: child.stdout });
    return {
        send(message) {
            return new Promise((resolve, reject) => {
                const handleLine = (line) => {
                    cleanup();
                    try {
                        resolve(JSON.parse(line));
                    }
                    catch (error) {
                        reject(error);
                    }
                };
                const handleError = (error) => {
                    cleanup();
                    reject(error);
                };
                const cleanup = () => {
                    rl.off('line', handleLine);
                    child.off('error', handleError);
                };
                rl.once('line', handleLine);
                child.once('error', handleError);
                child.stdin.write(`${JSON.stringify(message)}\n`);
            });
        },
    };
}
function createStdioLspTransport(child) {
    let buffer = '';
    const listeners = new Set();
    const pending = new Map();
    const handleStdout = (chunk) => {
        buffer += chunk.toString();
        const messages = decodeLspFrames(buffer);
        if (messages.length === 0) {
            return;
        }
        let consumed = 0;
        for (const message of messages) {
            const frame = encodeLspEnvelope(message);
            consumed += Buffer.byteLength(frame, 'utf8');
            if (typeof message.id === 'number' && pending.has(message.id)) {
                const request = pending.get(message.id);
                pending.delete(message.id);
                request.resolve(message);
                continue;
            }
            for (const listener of listeners) {
                listener(message);
            }
        }
        buffer = buffer.slice(consumed);
    };
    const handleError = (error) => {
        for (const request of pending.values()) {
            request.reject(error);
        }
        pending.clear();
    };
    child.stdout.on('data', handleStdout);
    child.on('error', handleError);
    return {
        send(message) {
            return new Promise((resolve, reject) => {
                if (typeof message.id === 'number') {
                    pending.set(message.id, { resolve, reject });
                }
                child.stdin.write(encodeLspEnvelope(message));
                if (typeof message.id !== 'number') {
                    resolve();
                }
            });
        },
        onMessage(handler) {
            listeners.add(handler);
            return () => {
                listeners.delete(handler);
            };
        },
        dispose() {
            child.stdout.off('data', handleStdout);
            child.off('error', handleError);
            processHandleDispose(child);
        },
    };
}
function encodeLspEnvelope(message) {
    const payload = JSON.stringify(message);
    return `Content-Length: ${Buffer.byteLength(payload, 'utf8')}\r\n\r\n${payload}`;
}
function processHandleDispose(child) {
    child.kill();
}
