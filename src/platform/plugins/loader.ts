import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { parsePluginManifest, type PluginManifest } from './manifest.js';

export interface LoadedPlugin extends PluginManifest {
  rootDir: string;
  collisions: string[];
}

export interface PluginLoaderOptions {
  builtinCommands?: string[];
}

export async function loadPlugins(dirs: string[], options: PluginLoaderOptions = {}): Promise<LoadedPlugin[]> {
  const loaded: LoadedPlugin[] = [];
  const builtinCommands = new Set(options.builtinCommands ?? []);

  for (const dir of dirs) {
    if (!existsSync(dir)) continue;

    for (const entry of readdirSync(dir)) {
      const pluginDir = join(dir, entry);
      const manifestPath = join(pluginDir, 'plugin.json');
      if (!existsSync(manifestPath)) continue;

      const raw = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
      const manifest = parsePluginManifest(raw, pluginDir);
      const collisions = manifest.commands
        .filter((command) => builtinCommands.has(command))
        .map((command) => `command:${command}`);

      loaded.push({
        ...manifest,
        rootDir: pluginDir,
        collisions,
      });
    }
  }

  return loaded;
}
