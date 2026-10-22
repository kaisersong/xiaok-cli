import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { posix, win32 } from 'node:path';
import { promisify } from 'node:util';
import type { NamedMcpServerConfig } from './types.js';

const execFileAsync = promisify(execFile);
const MCP_V2_IMPORT_CHECK = 'from mcp.server.mcpserver import MCPServer';

/** Keep implicit imports out of the signed runtime, including child interpreters. */
export function buildManagedPythonChildEnv(baseEnv: Record<string, string>): Record<string, string>;
export function buildManagedPythonChildEnv(baseEnv: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
export function buildManagedPythonChildEnv(baseEnv: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return { ...baseEnv, PYTHONDONTWRITEBYTECODE: '1' };
}

export interface ResolveBuiltinSlideRendererConfigOptions {
  platform?: NodeJS.Platform;
  homeDir?: string;
  pathExists?: (path: string) => boolean;
  canImportMcpV2?: (pythonCommand: string) => Promise<boolean>;
}

async function canImportMcpV2(pythonCommand: string): Promise<boolean> {
  try {
    await execFileAsync(pythonCommand, ['-B', '-c', MCP_V2_IMPORT_CHECK], {
      timeout: 15_000,
      env: buildManagedPythonChildEnv(process.env),
    });
    return true;
  } catch {
    return false;
  }
}

export async function resolveBuiltinSlideRendererConfig(
  server: NamedMcpServerConfig,
  options: ResolveBuiltinSlideRendererConfigOptions = {},
): Promise<NamedMcpServerConfig> {
  if (
    server.type !== 'stdio'
    || server.name !== 'slide-renderer'
    || server.source?.origin !== 'plugin'
    || server.source.pluginName !== 'kai-slide-creator'
  ) {
    return server;
  }

  const platform = options.platform ?? process.platform;
  const pathApi = platform === 'win32' ? win32 : posix;
  const managedPython = platform === 'win32'
    ? pathApi.join(options.homeDir ?? homedir(), '.xiaok', 'runtime', 'python-env', 'Scripts', 'python.exe')
    : pathApi.join(options.homeDir ?? homedir(), '.xiaok', 'runtime', 'python-env', 'bin', 'python3');
  const pathExists = options.pathExists ?? existsSync;
  if (!pathExists(managedPython)) return server;

  const importCheck = options.canImportMcpV2 ?? canImportMcpV2;
  if (!await importCheck(managedPython)) return server;

  return {
    ...server,
    command: managedPython,
    args: ['-B', ...(server.args ?? [])],
    env: buildManagedPythonChildEnv({
      ...server.env,
      PYTHONUTF8: '1',
      PYTHONIOENCODING: 'utf-8',
    }),
  };
}
