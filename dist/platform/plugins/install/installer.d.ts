import { type McpConnectFn, type ProbeResult } from './probe.js';
import { type RegistryRequest } from './registry.js';
import { type CommandRunner } from './source.js';
export type InstallPhase = 'fetch_registry' | 'acquire_lock' | 'clone_version' | 'verify_source' | 'validate_manifest' | 'install_dependencies' | 'probe_mcp' | 'activate' | 'prune';
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
export declare function installPlugin(name: string, options?: InstallPluginOptions): Promise<InstallPluginResult>;
