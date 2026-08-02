import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { posix, win32 } from 'node:path';
import { promisify } from 'node:util';
const execFileAsync = promisify(execFile);
const MCP_V2_IMPORT_CHECK = 'from mcp.server.mcpserver import MCPServer';
async function canImportMcpV2(pythonCommand) {
    try {
        await execFileAsync(pythonCommand, ['-c', MCP_V2_IMPORT_CHECK], { timeout: 15_000 });
        return true;
    }
    catch {
        return false;
    }
}
export async function resolveBuiltinSlideRendererConfig(server, options = {}) {
    if (server.type !== 'stdio'
        || server.name !== 'slide-renderer'
        || server.source?.origin !== 'plugin'
        || server.source.pluginName !== 'kai-slide-creator') {
        return server;
    }
    const platform = options.platform ?? process.platform;
    const pathApi = platform === 'win32' ? win32 : posix;
    const managedPython = platform === 'win32'
        ? pathApi.join(options.homeDir ?? homedir(), '.xiaok', 'runtime', 'python-env', 'Scripts', 'python.exe')
        : pathApi.join(options.homeDir ?? homedir(), '.xiaok', 'runtime', 'python-env', 'bin', 'python3');
    const pathExists = options.pathExists ?? existsSync;
    if (!pathExists(managedPython))
        return server;
    const importCheck = options.canImportMcpV2 ?? canImportMcpV2;
    if (!await importCheck(managedPython))
        return server;
    return {
        ...server,
        command: managedPython,
        env: {
            ...server.env,
            PYTHONUTF8: '1',
            PYTHONIOENCODING: 'utf-8',
        },
    };
}
