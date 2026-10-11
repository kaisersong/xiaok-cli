import type { Config } from '../types.js';
export declare function getConfigDir(subdir?: string): string;
export declare function getConfigPath(): string;
export declare class ConfigPermissionError extends Error {
    constructor(path: string, cause?: unknown);
}
export declare function loadConfig(): Promise<Config>;
/** Shared normalized read for synchronous Store construction and async callers. */
export declare function loadConfigSync(): Config;
export declare function saveConfig(config: Config): Promise<void>;
