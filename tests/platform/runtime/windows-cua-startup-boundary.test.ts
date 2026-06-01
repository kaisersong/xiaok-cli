import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

  it('imports the compiled runtime without the CUA manager and skips CUA on Windows', async () => {
    const builtContextPath = join(process.cwd(), '.test-dist', 'src', 'platform', 'runtime', 'context.js');
    const builtCuaManagerPath = join(process.cwd(), '.test-dist', 'src', 'platform', 'mcp', 'cua-connection-manager.js');

    if (!existsSync(builtContextPath)) {
      throw new Error('Run npm run test:sandbox:build before this package-boundary test.');
    }
    if (!existsSync(builtCuaManagerPath)) {
      throw new Error('The compiled CUA manager fixture is missing before the test starts.');
    }

    const originalCuaManager = readFileSync(builtCuaManagerPath);
    rmSync(builtCuaManagerPath, { force: true });

    try {
      const runtimeModuleUrl = `${pathToFileURL(builtContextPath).href}?windows-cua-boundary=${Date.now()}-${Math.random()}`;
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
            name: 'cua-driver',
            type: 'stdio',
            command: 'cua-driver',
            args: ['mcp'],
            requiresUserActivation: true,
          },
        ],
      });

      const context = await runtimeModule.createPlatformRuntimeContext({
        cwd,
        builtinCommands: ['chat'],
        reminderMode: 'local',
        platform: 'win32',
      });
      await context.mcpReady;

      expect(context.mcpTools.map((tool) => tool.definition.name)).not.toContain('xiaok_computer_use');
      expect(context.health.summary()).toContain('mcp:cua-driver degraded');
      expect(context.health.summary()).toContain('macOS-only');

      await context.dispose();
    } finally {
      writeFileSync(builtCuaManagerPath, originalCuaManager);
    }
  });
});
