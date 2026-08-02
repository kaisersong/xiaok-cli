import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  acquirePluginLock,
  pruneManagedVersions,
  prunePluginRuntimeVersions,
  readActivePluginPointer,
  switchActivePluginPointer,
  type ActivePluginPointer,
} from './active-pointer.js';
import { resolveVenvPython, runInstallSteps } from './dependencies.js';
import { probePluginMcpServers, validateCandidatePlugin, type McpConnectFn, type ProbeResult } from './probe.js';
import {
  DEFAULT_REGISTRY_V2_URL,
  fetchTrustedRegistryDocument,
  type RegistryRequest,
  type TrustedRegistryPlugin,
} from './registry.js';
import {
  resolveDefaultPluginsDir,
  resolveInstallPaths,
  stagePluginSource,
  type CommandRunner,
  type InstallPaths,
} from './source.js';

export type InstallPhase =
  | 'fetch_registry'
  | 'acquire_lock'
  | 'clone_version'
  | 'verify_source'
  | 'validate_manifest'
  | 'install_dependencies'
  | 'probe_mcp'
  | 'activate'
  | 'prune';

export interface InstallEvent {
  phase: InstallPhase;
  message: string;
}

export interface InstallPluginOptions {
  pluginsDir?: string;
  registryUrl?: string;
  trustRegistry?: boolean;
  force?: boolean;
  request?: RegistryRequest;
  cloneUrl?: string;
  allowLocalSource?: boolean;
  runner?: CommandRunner;
  connect?: McpConnectFn;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  onEvent?: (event: InstallEvent) => void;
  now?: () => Date;
}

export interface InstallPluginResult {
  status: 'installed' | 'already-installed';
  name: string;
  displayName: string;
  version: string;
  digest: string;
  commit: string;
  registryUrl: string;
  versionDir: string;
  pluginDir: string;
  probe: ProbeResult;
  skippedServerNames: string[];
  prunedVersionDirs: string[];
  prunedRuntimeDirs: string[];
  previousDigest?: string;
}

function readPointerSafely(paths: InstallPaths, name: string): ActivePluginPointer | null {
  if (!existsSync(join(paths.activeDir, `${name}.json`))) return null;
  try {
    return readActivePluginPointer(paths, name);
  } catch {
    return null;
  }
}

function alreadyInstalled(
  entry: TrustedRegistryPlugin,
  pointer: ActivePluginPointer,
  registryUrl: string,
): InstallPluginResult {
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

export async function installPlugin(
  name: string,
  options: InstallPluginOptions = {},
): Promise<InstallPluginResult> {
  const paths = resolveInstallPaths(options.pluginsDir ?? resolveDefaultPluginsDir(options.env));
  const registryUrl = options.registryUrl ?? DEFAULT_REGISTRY_V2_URL;
  const emit = (phase: InstallPhase, message: string) => options.onEvent?.({ phase, message });

  emit('fetch_registry', 'Fetching plugin registry v2...');
  const registry = await fetchTrustedRegistryDocument({
    registryUrl: options.registryUrl,
    trustRegistry: options.trustRegistry,
    request: options.request,
  });

  const entry = registry.plugins.find((plugin) => plugin.name === name);
  if (!entry) {
    throw new Error(
      `Plugin "${name}" is not in the trusted registry. Available: ${registry.plugins.map((plugin) => plugin.name).join(', ')}`,
    );
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
    let candidateRuntimeDirs: string[] = [];

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
      const { previous } = await switchActivePluginPointer(
        paths,
        {
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
        },
        options.now,
      );

      emit('prune', 'Removing unreferenced plugin versions...');
      const keep = [staged.digest, previous?.digest].filter((digest): digest is string => Boolean(digest));
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
    } catch (error) {
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
  } finally {
    await lock.release();
  }
}
