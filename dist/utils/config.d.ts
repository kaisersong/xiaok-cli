import type { Config } from '../types.js';
export declare function getConfigDir(subdir?: string): string;
export declare function getConfigPath(): string;
export declare class ConfigPermissionError extends Error {
    constructor(path: string, cause?: unknown);
}
export declare function loadConfig(): Promise<Config>;
export declare function saveConfig(config: Config): Promise<void>;
/** One synchronous semantic edit; does not make unrelated whole-config writers transactional. */
export declare function updateGlobalBackgroundAutoRun(enabled: unknown, requestSource?: 'user' | 'agent' | 'scheduler'): void;
