import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { parsePluginManifest } from './manifest.js';
import { resolveManagedPlugins } from './install/active-pointer.js';
import { resolveVenvPython } from './install/dependencies.js';
import { RESERVED_PLUGIN_DIR_NAMES } from './install/source.js';
export async function loadPlugins(dirs, options = {}) {
    const loaded = [];
    const builtinCommands = new Set(options.builtinCommands ?? []);
    const platform = options.platform ?? process.platform;
    for (const dir of dirs) {
        if (!existsSync(dir))
            continue;
        const managed = resolveManagedPlugins(dir);
        const managedNames = new Set([
            ...managed.entries.map((entry) => entry.name),
            ...managed.invalid.map((entry) => entry.name),
        ]);
        const candidates = managed.entries.map((entry) => ({
            name: entry.name,
            pluginDir: entry.pointer.pluginDir,
            ...(entry.pointer.pythonRuntimeDir ? { pythonRuntimeDir: entry.pointer.pythonRuntimeDir } : {}),
        }));
        for (const entry of readdirSync(dir)) {
            // Backups are not deployments; managed hidden versions are resolved above.
            if (entry.startsWith('.') || entry.endsWith('.legacy-backup') || RESERVED_PLUGIN_DIR_NAMES.includes(entry))
                continue;
            // An active managed version always wins over a same-named legacy directory.
            if (managedNames.has(entry))
                continue;
            candidates.push({ name: entry, pluginDir: join(dir, entry) });
        }
        for (const candidate of candidates) {
            try {
                const manifestPath = join(candidate.pluginDir, 'plugin.json');
                if (!existsSync(manifestPath))
                    continue;
                const raw = JSON.parse(readFileSync(manifestPath, 'utf8'));
                let manifest = parsePluginManifest(raw, candidate.pluginDir);
                // The official CUA identity includes its deployment name (also for
                // managed pointers). A renamed manifest must not fall through to eager
                // activation as a different plugin, or impersonate CUA from another dir.
                if ((candidate.name === 'cua-computer-use' || manifest.name === 'cua-computer-use')
                    && candidate.name !== manifest.name)
                    continue;
                let effectiveDir = candidate.pluginDir;
                if (platform === 'win32' && candidate.name === 'cua-computer-use'
                    && managed.entries.some(entry => entry.name === candidate.name)
                    && manifest.platforms?.length && !manifest.platforms.includes(platform)
                    && options.desktopCuaBundleDir) {
                    const bundled = parsePluginManifest(JSON.parse(readFileSync(join(options.desktopCuaBundleDir, 'plugin.json'), 'utf8')), options.desktopCuaBundleDir);
                    const version = (value) => /^\d+\.\d+\.\d+$/.test(value) ? value.split('.').map(Number) : null;
                    const current = version(manifest.version);
                    const next = version(bundled.version);
                    const newer = current && next && next.some((part, index) => part > current[index] && next.slice(0, index).every((prior, i) => prior === current[i]));
                    if (newer && bundled.name === 'cua-computer-use' && bundled.platforms?.includes('win32')
                        && bundled.mcpServers?.length === 1 && bundled.mcpServers[0].name === 'cua-driver' && bundled.mcpServers[0].type === 'stdio') {
                        manifest = bundled;
                        effectiveDir = options.desktopCuaBundleDir;
                    }
                }
                if (manifest.platforms?.length && !manifest.platforms.includes(platform)) {
                    continue;
                }
                if (candidate.pythonRuntimeDir) {
                    const pythonCommand = resolveVenvPython(candidate.pythonRuntimeDir, platform);
                    manifest.mcpServers = manifest.mcpServers?.map((server) => (server.type === 'stdio' && (server.command === 'python' || server.command === 'python3')
                        ? { ...server, command: pythonCommand }
                        : server));
                }
                const collisions = manifest.commands
                    .filter((command) => builtinCommands.has(command))
                    .map((command) => `command:${command}`);
                loaded.push({
                    ...manifest,
                    rootDir: effectiveDir,
                    collisions,
                });
            }
            catch {
                continue;
            }
        }
    }
    return loaded;
}
