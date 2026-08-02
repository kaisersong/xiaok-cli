import type { NamedMcpServerConfig } from './types.js';
export interface ResolveBuiltinSlideRendererConfigOptions {
    platform?: NodeJS.Platform;
    homeDir?: string;
    pathExists?: (path: string) => boolean;
    canImportMcpV2?: (pythonCommand: string) => Promise<boolean>;
}
export declare function resolveBuiltinSlideRendererConfig(server: NamedMcpServerConfig, options?: ResolveBuiltinSlideRendererConfigOptions): Promise<NamedMcpServerConfig>;
