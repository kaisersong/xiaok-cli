import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

function writePlugin(
  cwd: string,
  name: string,
  manifest: Record<string, unknown>,
): void {
  const pluginDir = join(cwd, '.xiaok', 'plugins', name);
  mkdirSync(pluginDir, { recursive: true });
  writeFileSync(join(pluginDir, 'plugin.json'), JSON.stringify(manifest, null, 2), 'utf8');
}

describe('Windows CUA startup boundary', () => {
  const tempDirs: string[] = [];
  let originalConfigDir: string | undefined;
  let originalDisableGlobalPlugins: string | undefined;

  beforeEach(() => {
    originalConfigDir = process.env.XIAOK_CONFIG_DIR;
    originalDisableGlobalPlugins = process.env.XIAOK_DISABLE_GLOBAL_PLUGINS;
    const configDir = join(tmpdir(), `xiaok-win-cua-config-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    tempDirs.push(configDir);
    mkdirSync(configDir, { recursive: true });
    process.env.XIAOK_CONFIG_DIR = configDir;
    process.env.XIAOK_DISABLE_GLOBAL_PLUGINS = '1';
  });

  afterEach(() => {
    if (originalConfigDir === undefined) {
      delete process.env.XIAOK_CONFIG_DIR;
    } else {
      process.env.XIAOK_CONFIG_DIR = originalConfigDir;
    }
    if (originalDisableGlobalPlugins === undefined) {
      delete process.env.XIAOK_DISABLE_GLOBAL_PLUGINS;
    } else {
      process.env.XIAOK_DISABLE_GLOBAL_PLUGINS = originalDisableGlobalPlugins;
    }

    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.each(['cua-driver', 'renamed-cua'])('imports the compiled runtime without the CUA manager and skips %s on Windows', async serverName => {
    const builtContextPath = join(process.cwd(), '.test-dist', 'src', 'platform', 'runtime', 'context.js');
    const builtCuaManagerPath = join(process.cwd(), '.test-dist', 'src', 'platform', 'mcp', 'cua-connection-manager.js');

    if (!existsSync(builtContextPath)) {
      throw new Error('Run npm run test:sandbox:build before this package-boundary test.');
    }
    if (!existsSync(builtCuaManagerPath)) {
      throw new Error('The compiled CUA manager fixture is missing before the test starts.');
    }

    const originalCuaManager = readFileSync(builtCuaManagerPath);
    const originalManagerMtime = statSync(builtCuaManagerPath, { bigint: true }).mtimeNs;
    const cacheRoot = join(process.cwd(), '.test-cache');
    mkdirSync(cacheRoot, { recursive: true });
    const packageRoot = mkdtempSync(join(cacheRoot, 'cua-win-boundary-'));
    tempDirs.push(packageRoot);
    cpSync(join(process.cwd(), '.test-dist', 'src'), join(packageRoot, 'src'), {
      recursive: true,
      filter: path => !['cua-connection-manager.js', 'cua-connection-manager.js.map'].some(name => path.endsWith(name)),
    });
    writeFileSync(join(packageRoot, 'package.json'), JSON.stringify({ type: 'module' }));
    expect(existsSync(join(packageRoot, 'src', 'platform', 'mcp', 'cua-connection-manager.js'))).toBe(false);
    let context: Awaited<ReturnType<typeof import('../../../src/platform/runtime/context.js')['createPlatformRuntimeContext']>> | undefined;
    try {
      const runtimeModuleUrl = pathToFileURL(join(packageRoot, 'src', 'platform', 'runtime', 'context.js')).href;
      const runtimeModule = await import(runtimeModuleUrl) as typeof import('../../../src/platform/runtime/context.js');

      const cwd = join(tmpdir(), `xiaok-win-cua-runtime-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      tempDirs.push(cwd);
      mkdirSync(join(cwd, '.xiaok'), { recursive: true });
      writePlugin(cwd, 'cua-computer-use', {
        name: 'cua-computer-use',
        version: '1.0.0',
        commands: [],
        mcpServers: [
          {
            name: serverName,
            type: 'stdio',
            command: 'cua-driver',
            args: ['mcp'],
            requiresUserActivation: true,
          },
        ],
      });

      context = await runtimeModule.createPlatformRuntimeContext({
        cwd,
        builtinCommands: ['chat'],
        reminderMode: 'local',
        platform: 'win32',
      });
      await context.mcpReady;

      expect(context.mcpTools.map((tool) => tool.definition.name)).not.toContain('xiaok_computer_use');
      expect(context.health.summary()).toContain(`mcp:${serverName} degraded`);
      expect(context.health.summary()).toContain(serverName === 'cua-driver' ? 'macOS-only' : 'COMPUTER_USE_PLUGIN_IDENTITY_MISMATCH');

    } finally {
      await context?.dispose();
      expect(readFileSync(builtCuaManagerPath)).toEqual(originalCuaManager);
      expect(statSync(builtCuaManagerPath, { bigint: true }).mtimeNs).toBe(originalManagerMtime);
    }
  });
});
