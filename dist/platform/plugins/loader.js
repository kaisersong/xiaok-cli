import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { parsePluginManifest } from './manifest.js';
export async function loadPlugins(dirs, options = {}) {
    const loaded = [];
    const builtinCommands = new Set(options.builtinCommands ?? []);
    for (const dir of dirs) {
        if (!existsSync(dir))
            continue;
        for (const entry of readdirSync(dir)) {
            const pluginDir = join(dir, entry);
            const manifestPath = join(pluginDir, 'plugin.json');
            if (!existsSync(manifestPath))
                continue;
            const raw = JSON.parse(readFileSync(manifestPath, 'utf8'));
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
