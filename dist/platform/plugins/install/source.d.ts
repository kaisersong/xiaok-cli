import { type GitObjectEntry } from './integrity.js';
import type { TrustedRegistryPlugin } from './registry.js';
export interface InstallPaths {
    pluginsDir: string;
    managedDir: string;
    activeDir: string;
    locksDir: string;
    runtimesDir: string;
}
export declare function resolveInstallPaths(pluginsDir: string): InstallPaths;
export declare function resolveDefaultPluginsDir(env?: NodeJS.ProcessEnv): string;
export declare const RESERVED_PLUGIN_DIR_NAMES: string[];
export interface RunCommandOptions {
    cwd?: string;
    env?: Record<string, string>;
    timeoutMs?: number;
}
export interface RunCommandResult {
    code: number;
    stdout: string;
    stderr: string;
}
export interface CommandRunner {
    run(command: string, args: string[], options?: RunCommandOptions): Promise<RunCommandResult>;
    runBuffer(command: string, args: string[], options?: RunCommandOptions): Promise<{
        code: number;
        stdout: Buffer;
        stderr: string;
    }>;
    /** Streams stdout through SHA-256 so large blobs never sit in memory. */
    hashStdout(command: string, args: string[], options?: RunCommandOptions): Promise<{
        code: number;
        sha256: string;
        bytes: number;
        stderr: string;
    }>;
}
export declare const defaultCommandRunner: CommandRunner;
export interface RecordedInvocation {
    command: string;
    args: string[];
    cwd?: string;
    env?: Record<string, string>;
}
export declare function createRecordingRunner(inner: CommandRunner): CommandRunner & {
    invocations: RecordedInvocation[];
};
/**
 * Git reads credentials, proxies, hooks and rewrite rules from ambient config,
 * so the install transaction runs with those inputs stripped rather than trusted.
 */
export declare function createGitEnv(baseEnv?: NodeJS.ProcessEnv, allowLocalSource?: boolean): Record<string, string>;
export interface StagePluginSourceOptions {
    entry: TrustedRegistryPlugin;
    paths: InstallPaths;
    cloneUrl?: string;
    allowLocalSource?: boolean;
    runner?: CommandRunner;
    platform?: NodeJS.Platform;
    timeoutMs?: number;
    /** Re-verify an existing managed checkout instead of re-cloning it. */
    reuseExistingCheckout?: boolean;
}
export interface StagedPluginSource {
    versionDir: string;
    repoDir: string;
    pluginDir: string;
    digest: string;
    commit: string;
    entries: GitObjectEntry[];
}
export declare function stagePluginSource(options: StagePluginSourceOptions): Promise<StagedPluginSource>;
