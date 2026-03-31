import { homedir } from 'os';
import { join } from 'path';
import { createInterface } from 'readline';
import { createMcpRuntimeClient, type McpRuntimeTransport } from '../../ai/mcp/runtime/client.js';
import { startMcpServerProcess } from '../../ai/mcp/runtime/server-process.js';
import { createLspClient, decodeLspFrames, type LspEnvelope, type LspTransport } from '../lsp/client.js';
import { startLspServerProcess } from '../lsp/server-process.js';
import { loadPlugins, type LoadedPlugin } from './loader.js';

export interface PlatformPluginRuntimeState {
  plugins: LoadedPlugin[];
  skillRoots: string[];
  agentDirs: string[];
  hookCommands: string[];
  commandDeclarations: string[];
  mcpServers: Array<{ name: string; command: string }>;
  lspServers: Array<{ name: string; command: string }>;
}

export async function loadPlatformPluginRuntime(
  cwd: string,
  builtinCommands: string[],
): Promise<PlatformPluginRuntimeState> {
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

export async function connectDeclaredMcpServer(declaration: { name: string; command: string }) {
  const processHandle = startMcpServerProcess('sh', ['-c', declaration.command]);
  const transport = createLineDelimitedMcpTransport(processHandle.child);
  const client = createMcpRuntimeClient(transport);
  await client.initialize();

  return {
    listTools: () => client.listTools(),
    callTool: (name: string, input: Record<string, unknown>) => client.callTool(name, input),
    dispose: () => processHandle.dispose(),
  };
}

export async function connectDeclaredLspServer(
  declaration: { name: string; command: string },
  manager: { applyMessage(message: LspEnvelope): void },
  rootUri: string,
) {
  const processHandle = startLspServerProcess('sh', ['-c', declaration.command]);
  const transport = createStdioLspTransport(processHandle.child);
  const client = createLspClient(transport, manager);
  await client.initialize(rootUri);

  return {
    didOpenDocument: (document: { uri: string; languageId: string; version?: number; text: string }) =>
      client.didOpenDocument(document),
    dispose: () => client.dispose(),
  };
}

function createLineDelimitedMcpTransport(
  child: ReturnType<typeof startMcpServerProcess>['child'],
): McpRuntimeTransport {
  const rl = createInterface({ input: child.stdout });

  return {
    send(message) {
      return new Promise((resolve, reject) => {
        const handleLine = (line: string) => {
          cleanup();
          try {
            resolve(JSON.parse(line) as Awaited<ReturnType<McpRuntimeTransport['send']>>);
          } catch (error) {
            reject(error);
          }
        };

        const handleError = (error: Error) => {
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

function createStdioLspTransport(
  child: ReturnType<typeof startLspServerProcess>['child'],
): LspTransport {
  let buffer = '';
  const listeners = new Set<(message: LspEnvelope) => void>();
  const pending = new Map<number, { resolve: (message: LspEnvelope) => void; reject: (error: Error) => void }>();

  const handleStdout = (chunk: Buffer | string) => {
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
        const request = pending.get(message.id)!;
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

  const handleError = (error: Error) => {
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

function encodeLspEnvelope(message: LspEnvelope): string {
  const payload = JSON.stringify(message);
  return `Content-Length: ${Buffer.byteLength(payload, 'utf8')}\r\n\r\n${payload}`;
}

function processHandleDispose(child: ReturnType<typeof startLspServerProcess>['child']): void {
  child.kill();
}
