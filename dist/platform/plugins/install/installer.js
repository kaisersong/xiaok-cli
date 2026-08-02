import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { acquirePluginLock, pruneManagedVersions, prunePluginRuntimeVersions, readActivePluginPointer, switchActivePluginPointer, } from './active-pointer.js';
import { resolveVenvPython, runInstallSteps } from './dependencies.js';
import { probePluginMcpServers, validateCandidatePlugin } from './probe.js';
import { DEFAULT_REGISTRY_V2_URL, fetchTrustedRegistryDocument, } from './registry.js';
import { resolveDefaultPluginsDir, resolveInstallPaths, stagePluginSource, } from './source.js';
function readPointerSafely(paths, name) {
    if (!existsSync(join(paths.activeDir, `${name}.json`)))
        return null;
    try {
        return readActivePluginPointer(paths, name);
    }
    catch {
        return null;
    }
}
function alreadyInstalled(entry, pointer, registryUrl) {
    return {
        status: 'already-installed',
        name: entry.name,
        displayName: entry.displayName,
        version: pointer.version,
        digest: pointer.digest,
        commit: pointer.commit,
        registryUrl,
        versionDir: pointer.versionDir,
        pluginDir: pointer.pluginDir,
        probe: pointer.probe,
        skippedServerNames: [],
        prunedVersionDirs: [],
        prunedRuntimeDirs: [],
        ...(pointer.previousDigest ? { previousDigest: pointer.previousDigest } : {}),
    };
}
export async function installPlugin(name, options = {}) {
    const paths = resolveInstallPaths(options.pluginsDir ?? resolveDefaultPluginsDir(options.env));
    const registryUrl = options.registryUrl ?? DEFAULT_REGISTRY_V2_URL;
    const emit = (phase, message) => options.onEvent?.({ phase, message });
    emit('fetch_registry', 'Fetching plugin registry v2...');
    const registry = await fetchTrustedRegistryDocument({
        registryUrl: options.registryUrl,
        trustRegistry: options.trustRegistry,
        request: options.request,
    });
    const entry = registry.plugins.find((plugin) => plugin.name === name);
    if (!entry) {
        throw new Error(`Plugin "${name}" is not in the trusted registry. Available: ${registry.plugins.map((plugin) => plugin.name).join(', ')}`);
    }
    const existing = readPointerSafely(paths, name);
    if (existing && existing.digest === entry.source.treeSha256 && !options.force) {
        return alreadyInstalled(entry, existing, registryUrl);
    }
    emit('acquire_lock', `Locking plugin "${name}"...`);
    const lock = await acquirePluginLock(paths, name);
    try {
        const active = readPointerSafely(paths, name);
        if (active && active.digest === entry.source.treeSha256 && !options.force) {
            return alreadyInstalled(entry, active, registryUrl);
        }
        const reuseExistingCheckout = active?.digest === entry.source.treeSha256;
        emit('clone_version', `Fetching ${entry.repo.owner}/${entry.repo.name}@${entry.source.commit.slice(0, 12)}...`);
        emit('verify_source', 'Verifying Git object contents against the registry digest...');
        const staged = await stagePluginSource({
            entry,
            paths,
            cloneUrl: options.cloneUrl,
            allowLocalSource: options.allowLocalSource,
            runner: options.runner,
            platform: options.platform,
            reuseExistingCheckout,
        });
        let candidateRuntimeDirs = [];
        try {
            emit('validate_manifest', 'Validating the candidate plugin manifest...');
            const manifest = validateCandidatePlugin(entry, staged.pluginDir);
            emit('install_dependencies', `Running ${entry.install.steps.length} typed install step(s)...`);
            const dependencies = await runInstallSteps({
                pluginName: entry.name,
                pluginDir: staged.pluginDir,
                digest: staged.digest,
                steps: entry.install.steps,
                paths,
                runner: options.runner,
                platform: options.platform,
                env: options.env,
                ...(active?.digest === staged.digest && active.pythonRuntimeDir
                    ? { reusePythonRuntimeDir: active.pythonRuntimeDir }
                    : {}),
            });
            candidateRuntimeDirs = dependencies.runtimeDirs;
            emit('probe_mcp', 'Verifying MCP servers with initialize + tools/list...');
            const runtimeDir = dependencies.runtimeDirs[0];
            const probe = await probePluginMcpServers({
                pluginDir: staged.pluginDir,
                manifest,
                platform: options.platform,
                skipServerNames: dependencies.skippedServerNames,
                connect: options.connect,
                ...(runtimeDir ? { pythonCommand: resolveVenvPython(runtimeDir, options.platform) } : {}),
            });
            emit('activate', 'Switching the active plugin pointer...');
            const previousDigest = active && active.digest !== staged.digest ? active.digest : undefined;
            const { previous } = await switchActivePluginPointer(paths, {
                name: entry.name,
                version: manifest.version,
                digest: staged.digest,
                commit: staged.commit,
                versionDir: staged.versionDir,
                pluginDir: staged.pluginDir,
                ...(runtimeDir ? { pythonRuntimeDir: runtimeDir } : {}),
                registryUrl,
                probe,
                ...(previousDigest ? { previousDigest } : {}),
            }, options.now);
            emit('prune', 'Removing unreferenced plugin versions...');
            const keep = [staged.digest, previous?.digest].filter((digest) => Boolean(digest));
            const prunedVersionDirs = pruneManagedVersions(paths, entry.name, keep);
            const prunedRuntimeDirs = prunePluginRuntimeVersions(paths, entry.name, keep);
            return {
                status: 'installed',
                name: entry.name,
                displayName: entry.displayName,
                version: manifest.version,
                digest: staged.digest,
                commit: staged.commit,
                registryUrl,
                versionDir: staged.versionDir,
                pluginDir: staged.pluginDir,
                probe,
                skippedServerNames: dependencies.skippedServerNames,
                prunedVersionDirs,
                prunedRuntimeDirs,
                ...(previous?.digest && previous.digest !== staged.digest ? { previousDigest: previous.digest } : {}),
            };
        }
        catch (error) {
            if (staged.versionDir !== active?.versionDir) {
                rmSync(staged.versionDir, { recursive: true, force: true });
            }
            if (staged.digest !== active?.digest) {
                for (const runtimeDir of candidateRuntimeDirs) {
                    rmSync(runtimeDir, { recursive: true, force: true });
                }
            }
            throw error;
        }
    }
    finally {
        await lock.release();
    }
}
