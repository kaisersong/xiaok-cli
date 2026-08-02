import type { TrustedInstallStep } from './registry.js';
import { type CommandRunner, type InstallPaths } from './source.js';
export declare const NPM_REGISTRY_URL = "https://registry.npmjs.org/";
export interface NpmInvocation {
    command: string;
    prefixArgs: string[];
}
export interface ResolveNpmOptions {
    platform?: NodeJS.Platform;
    execPath?: string;
    env?: NodeJS.ProcessEnv;
}
/**
 * Windows ships npm as a `.cmd` shim, and spawning it without a shell throws
 * EINVAL, so the install runs npm's JS entry point through the Node binary.
 */
export declare function resolveNpmInvocation(options?: ResolveNpmOptions): NpmInvocation;
export declare function resolvePythonCommand(platform?: NodeJS.Platform, env?: NodeJS.ProcessEnv): string;
export declare function resolveVenvPython(runtimeDir: string, platform?: NodeJS.Platform): string;
export interface InstallStepResult {
    step: TrustedInstallStep;
    status: 'completed' | 'skipped';
    skippedServerNames?: string[];
}
export interface RunInstallStepsOptions {
    pluginName: string;
    pluginDir: string;
    digest: string;
    steps: TrustedInstallStep[];
    paths: InstallPaths;
    runner?: CommandRunner;
    platform?: NodeJS.Platform;
    env?: NodeJS.ProcessEnv;
    execPath?: string;
    timeoutMs?: number;
    reusePythonRuntimeDir?: string;
}
export interface RunInstallStepsResult {
    results: InstallStepResult[];
    skippedServerNames: string[];
    runtimeDirs: string[];
}
export declare function assertHashedRequirements(requirementsPath: string): void;
export declare function runInstallSteps(options: RunInstallStepsOptions): Promise<RunInstallStepsResult>;
