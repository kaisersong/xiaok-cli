import { homedir } from 'os';
import { join } from 'path';
import { createMcpRuntimeClient } from '../../ai/mcp/runtime/client.js';
import { createStdioMcpTransport, startMcpServerProcess } from '../../ai/mcp/runtime/server-process.js';
import { createLspClient, type LspEnvelope } from '../lsp/client.js';
import { createStdioLspTransport, startLspServerProcess } from '../lsp/server-process.js';
import { loadPlugins, type LoadedPlugin } from './loader.js';

import type { PluginManifestHook } from './manifest.js';
import type { HookConfigOrCommand } from '../../runtime/hooks-runner.js';

export interface PlatformPluginRuntimeState {
  plugins: LoadedPlugin[];
  skillRoots: string[];
  agentDirs: string[];
  /** Structured hook configs (new) or legacy command strings */
  hookConfigs: HookConfigOrCommand[];
  /** @deprecated Use hookConfigs. Retained for backward compat. */
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

  const rawHooks = plugins.flatMap((plugin) => plugin.hooks);
  const hookConfigs: HookConfigOrCommand[] = rawHooks.map((h) => {
    if (typeof h === 'string') return h;
    // Convert PluginManifestHook to the appropriate HookConfig variant
    if (h.type === 'http' && h.url) {
      return { type: 'http' as const, url: h.url, events: h.events, matcher: h.matcher, tools: h.tools, timeoutMs: h.timeoutMs, async: h.async, asyncRewake: h.asyncRewake, once: h.once, statusMessage: h.statusMessage, headers: h.headers };
    }
    if (h.type === 'prompt' && h.prompt) {
      return { type: 'prompt' as const, prompt: h.prompt, events: h.events, matcher: h.matcher, tools: h.tools, timeoutMs: h.timeoutMs, async: h.async, asyncRewake: h.asyncRewake, once: h.once, statusMessage: h.statusMessage, model: h.model };
    }
    return { type: 'command' as const, command: h.command, events: h.events, matcher: h.matcher, tools: h.tools, timeoutMs: h.timeoutMs, async: h.async, asyncRewake: h.asyncRewake, once: h.once, statusMessage: h.statusMessage };
  });
  const hookCommands: string[] = rawHooks.map((h) =>
    typeof h === 'string' ? h : h.command,
  );

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
    goToDefinition: (uri: string, line: number, character: number) =>
      client.goToDefinition(uri, line, character),
    findReferences: (uri: string, line: number, character: number) =>
      client.findReferences(uri, line, character),
    hover: (uri: string, line: number, character: number) =>
      client.hover(uri, line, character),
    documentSymbols: (uri: string) =>
      client.documentSymbols(uri),
    dispose: () => client.dispose(),
  };
}
