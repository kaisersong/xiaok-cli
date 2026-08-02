import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { parsePluginManifest, type PluginManifest } from './manifest.js';
import { resolveManagedPlugins } from './install/active-pointer.js';
import { resolveVenvPython } from './install/dependencies.js';
import { RESERVED_PLUGIN_DIR_NAMES } from './install/source.js';

export interface LoadedPlugin extends PluginManifest {
  rootDir: string;
  collisions: string[];
}

export interface PluginLoaderOptions {
  builtinCommands?: string[];
  platform?: NodeJS.Platform;
}

export async function loadPlugins(dirs: string[], options: PluginLoaderOptions = {}): Promise<LoadedPlugin[]> {
  const loaded: LoadedPlugin[] = [];
  const builtinCommands = new Set(options.builtinCommands ?? []);
  const platform = options.platform ?? process.platform;

  for (const dir of dirs) {
    if (!existsSync(dir)) continue;

    const managed = resolveManagedPlugins(dir);
    const managedNames = new Set([
      ...managed.entries.map((entry) => entry.name),
      ...managed.invalid.map((entry) => entry.name),
    ]);
    const candidates: Array<{ name: string; pluginDir: string; pythonRuntimeDir?: string }> = managed.entries.map((entry) => ({
      name: entry.name,
      pluginDir: entry.pointer.pluginDir,
      ...(entry.pointer.pythonRuntimeDir ? { pythonRuntimeDir: entry.pointer.pythonRuntimeDir } : {}),
    }));

    for (const entry of readdirSync(dir)) {
      if (RESERVED_PLUGIN_DIR_NAMES.includes(entry)) continue;
      // An active managed version always wins over a same-named legacy directory.
      if (managedNames.has(entry)) continue;
      candidates.push({ name: entry, pluginDir: join(dir, entry) });
    }

    for (const candidate of candidates) {
      try {
        const manifestPath = join(candidate.pluginDir, 'plugin.json');
        if (!existsSync(manifestPath)) continue;

        const raw = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
        const manifest = parsePluginManifest(raw, candidate.pluginDir);
        if (manifest.platforms?.length && !manifest.platforms.includes(platform)) {
          continue;
        }
        if (candidate.pythonRuntimeDir) {
          const pythonCommand = resolveVenvPython(candidate.pythonRuntimeDir, platform);
          manifest.mcpServers = manifest.mcpServers?.map((server) => (
            server.type === 'stdio' && (server.command === 'python' || server.command === 'python3')
              ? { ...server, command: pythonCommand }
              : server
          ));
        }
        const collisions = manifest.commands
          .filter((command) => builtinCommands.has(command))
          .map((command) => `command:${command}`);

        loaded.push({
          ...manifest,
          rootDir: candidate.pluginDir,
          collisions,
        });
      } catch {
        continue;
      }
    }
  }

  return loaded;
}
