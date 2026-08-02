import type { ProbeResult } from './probe.js';
import type { InstallPaths } from './source.js';
export interface ActivePluginPointerInput {
    name: string;
    version: string;
    digest: string;
    commit: string;
    versionDir: string;
    pluginDir: string;
    pythonRuntimeDir?: string;
    registryUrl: string;
    probe: ProbeResult;
    previousDigest?: string;
}
export interface ActivePluginPointer extends ActivePluginPointerInput {
    pointerVersion: 1;
    installedAt: string;
}
export declare function activePointerPath(paths: InstallPaths, name: string): string;
export declare function assertValidPluginName(name: string): void;
export declare function switchActivePluginPointer(paths: InstallPaths, input: ActivePluginPointerInput, now?: () => Date): Promise<{
    previous: ActivePluginPointer | null;
}>;
export declare function readActivePluginPointer(paths: InstallPaths, name: string): ActivePluginPointer;
export interface ResolvedManagedPlugins {
    entries: Array<{
        name: string;
        pointer: ActivePluginPointer;
    }>;
    invalid: Array<{
        name: string;
        reason: string;
    }>;
}
export declare function resolveManagedPlugins(pluginsDir: string): ResolvedManagedPlugins;
export declare function removeActivePluginPointer(paths: InstallPaths, name: string): boolean;
export declare function pruneManagedVersions(paths: InstallPaths, name: string, keepDigests: string[]): string[];
export declare function prunePluginRuntimeVersions(paths: InstallPaths, name: string, keepDigests: string[]): string[];
export interface PluginLock {
    release(): Promise<void>;
}
export interface AcquirePluginLockOptions {
    staleAfterMs?: number;
    isProcessAlive?: (pid: number) => boolean;
}
export declare function acquirePluginLock(paths: InstallPaths, name: string, options?: AcquirePluginLockOptions): Promise<PluginLock>;
