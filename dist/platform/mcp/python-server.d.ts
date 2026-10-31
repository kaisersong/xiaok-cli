import type { NamedMcpServerConfig } from './types.js';
/** Keep implicit imports out of the signed runtime, including child interpreters. */
export declare function buildManagedPythonChildEnv(baseEnv: Record<string, string>): Record<string, string>;
export declare function buildManagedPythonChildEnv(baseEnv: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
export interface ResolveBuiltinSlideRendererConfigOptions {
    platform?: NodeJS.Platform;
    homeDir?: string;
    pathExists?: (path: string) => boolean;
    canImportMcpV2?: (pythonCommand: string) => Promise<boolean>;
}
export declare function resolveBuiltinSlideRendererConfig(server: NamedMcpServerConfig, options?: ResolveBuiltinSlideRendererConfigOptions): Promise<NamedMcpServerConfig>;
