import type { Config } from '../types.js';
export declare function getConfigDir(subdir?: string): string;
export declare function getConfigPath(): string;
export declare function loadConfig(): Promise<Config>;
export declare function saveConfig(config: Config): Promise<void>;
