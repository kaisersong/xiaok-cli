import { homedir } from 'os';
import { join } from 'path';
import { createMcpRuntimeClient } from '../../ai/mcp/runtime/client.js';
import { createStdioMcpTransport, startMcpServerProcess } from '../../ai/mcp/runtime/server-process.js';
import { createLspClient, type LspEnvelope } from '../lsp/client.js';
import { createStdioLspTransport, startLspServerProcess } from '../lsp/server-process.js';
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

export function resolvePluginShellCommand(
  command: string,
  platform: NodeJS.Platform = process.platform,
): { command: string; args: string[] } {
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
  const shell = resolvePluginShellCommand(declaration.command);
  const processHandle = startMcpServerProcess(shell.command, shell.args);
  const transport = createStdioMcpTransport(processHandle.child);
  const client = createMcpRuntimeClient(transport);
  try {
    await client.initialize();
  } catch (error) {
    transport.dispose();
    processHandle.dispose();
    throw error;
  }

  return {
    listTools: () => client.listTools(),
    callTool: (name: string, input: Record<string, unknown>) => client.callTool(name, input),
    dispose: () => {
      transport.dispose();
      processHandle.dispose();
    },
  };
}

export async function connectDeclaredLspServer(
  declaration: { name: string; command: string },
  manager: { applyMessage(message: LspEnvelope): void },
  rootUri: string,
) {
  const shell = resolvePluginShellCommand(declaration.command);
  const processHandle = startLspServerProcess(shell.command, shell.args);
  const transport = createStdioLspTransport(processHandle.child);
  const client = createLspClient(transport, manager);
  try {
    await client.initialize(rootUri);
  } catch (error) {
    client.dispose();
    throw error;
  }

  return {
    didOpenDocument: (document: { uri: string; languageId: string; version?: number; text: string }) =>
      client.didOpenDocument(document),
    dispose: () => client.dispose(),
  };
}
