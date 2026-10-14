import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative, posix, win32 } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { createMcpClientConnection, resolveStdioCommand } from '../../../src/platform/mcp/transport.js';
import { parsePluginManifest } from '../../../src/platform/plugins/manifest.js';
import { createPlatformRuntimeContext } from '../../../src/platform/runtime/context.js';

describe('MCP executable home paths', () => {
  it('expands only the current-user home prefix across platforms and Python overrides', () => {
    const unixHome = posix.join('/tmp', 'fixture home;literal');
    const windowsHome = win32.join('C:\\', 'fixture home');
    expect(resolveStdioCommand('~/.local/bin/cua-driver', 'darwin', {}, unixHome))
      .toBe(posix.join(unixHome, '.local', 'bin', 'cua-driver'));
    expect(resolveStdioCommand('~/bin/server', 'linux', {}, unixHome)).toBe(posix.join(unixHome, 'bin', 'server'));
    expect(resolveStdioCommand('~', 'darwin', {}, unixHome)).toBe(unixHome);
    expect(resolveStdioCommand('~/bin/server.exe', 'win32', {}, windowsHome))
      .toBe(win32.join(windowsHome, 'bin', 'server.exe'));
    expect(resolveStdioCommand('~\\bin\\server.exe', 'win32', {}, windowsHome))
      .toBe(win32.join(windowsHome, 'bin', 'server.exe'));
    expect(resolveStdioCommand('python3', 'win32', { XIAOK_PYTHON_CMD: '~/python.exe' }, windowsHome))
      .toBe(win32.join(windowsHome, 'python.exe'));
    for (const command of ['node', 'python', './server', '/opt/bin/server', 'C:\\bin\\server.exe',
      '\\\\host\\share\\server.exe', '~someone/bin/server', '$HOME/bin/server', 'node && echo unsafe']) {
      expect(resolveStdioCommand(command, 'darwin', {}, unixHome)).toBe(command);
    }
    expect(resolveStdioCommand('~\\literal', 'darwin', {}, unixHome)).toBe('~\\literal');
    expect(resolveStdioCommand('python3', 'win32', {}, windowsHome)).toBe('python');
  });

  it('keeps subcommands and values while resolving bundled relative scripts', () => {
    const root = join(homedir(), 'fixture-plugin');
    const args = ['mcp', '--direct', '123', 'module.name', 'https://example.test/mcp',
      'C:\\runtime\\server.py', '\\\\host\\share\\server.js', '-e', 'process.exit(1)',
      'mcp-servers/demo/server.py', 'server.mjs'];
    const manifest = parsePluginManifest({ name: 'fixture', version: '1.0.0',
      mcpServers: [{ name: 'server', type: 'stdio', command: 'node', args }] }, root);
    expect(manifest.mcpServers?.[0]).toMatchObject({ args: [
      ...args.slice(0, -2), join(root, 'mcp-servers', 'demo', 'server.py'), join(root, 'server.mjs'),
    ] });
  });

  it.each(['sdk', 'controlled'] as const)('performs a real %s MCP handshake from a ~/ executable', async stdioLifecycle => {
    const root = mkdtempSync(join(homedir(), '.xiaok-mcp-home-test-'));
    const executable = join(root, process.platform === 'win32' ? 'node with spaces.exe' : 'node with spaces');
    if (process.platform === 'win32') copyFileSync(process.execPath, executable);
    else symlinkSync(process.execPath, executable);
    let connection: Awaited<ReturnType<typeof createMcpClientConnection>> | undefined;
    let pid: number | null = null;
    try {
      connection = await createMcpClientConnection('home-path-fixture', {
        type: 'stdio', command: `~/${relative(homedir(), executable).replace(/\\/g, '/')}`,
        args: [join(process.cwd(), 'tests', 'support', 'mcp-stdio-server.js')],
        protocol: { mode: 'legacy' }, timeout: { startup: 5_000 },
      }, stdioLifecycle === 'controlled' ? {
        stdioLifecycle, finalEnv: { PATH: process.env.PATH ?? '' },
        controlledClose: { forceKillGuard: { canForceKill: async () => true } },
      } : { stdioLifecycle });
      pid = connection.getChildPid();
      expect(pid).toBeGreaterThan(0);
      expect((await connection.client.listTools()).tools.map(tool => tool.name)).toContain('search');
    } finally {
      await connection?.close();
      if (pid !== null) expect(() => process.kill(pid!, 0)).toThrow();
      rmSync(root, { recursive: true, force: true, maxRetries: 3 });
    }
  });

  it.skipIf(process.platform !== 'darwin')('activates CUA through loader, frozen launch plan and wrapper with a bare mcp argument', async () => {
    const root = mkdtempSync(join(homedir(), '.xiaok-cua-home-test-'));
    let context: Awaited<ReturnType<typeof createPlatformRuntimeContext>> | undefined;
    const launchLog = join(root, 'launch.log');
    try {
      vi.stubEnv('XIAOK_CONFIG_DIR', join(root, 'config'));
      vi.stubEnv('XIAOK_DISABLE_GLOBAL_PLUGINS', '1');
      const pluginDir = join(root, '.xiaok', 'plugins', 'cua-computer-use');
      mkdirSync(pluginDir, { recursive: true });
      const executable = join(root, 'cua-driver');
      symlinkSync(process.execPath, executable);
      writeFileSync(join(pluginDir, 'server.mjs'), [
        "import { writeFileSync } from 'node:fs';",
        "if (JSON.stringify(process.argv.slice(2)) !== '[\"mcp\"]') process.exit(2);",
        `writeFileSync(${JSON.stringify(launchLog)}, String(process.pid));`,
        `await import(${JSON.stringify(pathToFileURL(join(process.cwd(), 'tests', 'support', 'cua-mcp-stdio-server.js')).href)});`,
      ].join('\n'));
      writeFileSync(join(pluginDir, 'plugin.json'), JSON.stringify({
        name: 'cua-computer-use', version: '1.0.0', commands: [],
        mcpServers: [{ name: 'cua-driver', type: 'stdio',
          command: `~/${relative(homedir(), executable)}`, args: ['server.mjs', 'mcp'],
          protocol: { mode: 'legacy' }, requiresUserActivation: true }],
      }));
      context = await createPlatformRuntimeContext({ cwd: root, builtinCommands: [], reminderMode: 'local' });
      await context.mcpReady;
      expect(existsSync(launchLog)).toBe(false);
      const tool = context.mcpTools.find(tool => tool.definition.name === 'xiaok_computer_use');
      expect(tool).toBeDefined();
      expect(JSON.parse(await tool!.execute({ action: 'list_apps' }))).toMatchObject({ ok: true });
      expect(existsSync(launchLog)).toBe(true);
    } finally {
      await context?.dispose();
      if (existsSync(launchLog)) {
        const pid = Number(readFileSync(launchLog, 'utf8'));
        // Runtime disposes CUA asynchronously; await the production exit helper.
        const { waitForProcessExit } = await import('../../../src/platform/mcp/transport.js');
        await waitForProcessExit(pid);
        expect(() => process.kill(pid, 0)).toThrow();
      }
      vi.unstubAllEnvs();
      rmSync(root, { recursive: true, force: true, maxRetries: 3 });
    }
  }, 15_000);
});
