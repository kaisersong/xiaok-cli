import type { Command } from 'commander';
interface InstalledPlugin {
    name: string;
    version: string;
    displayName: string;
    description: string;
    origin: 'managed' | 'directory';
    probeStatus?: 'verified' | 'unverified';
    invalid?: string;
}
export declare function listInstalledPlugins(pluginsDir?: string): InstalledPlugin[];
export declare function runInstall(name: string, opts: {
    registry?: string;
    force?: boolean;
    trustRegistry?: boolean;
}): Promise<void>;
export declare function runList(): void;
export declare function runSearch(query?: string, opts?: {
    registry?: string;
}): Promise<void>;
export declare function runUninstall(name: string): void;
export declare function registerPluginCommands(program: Command): void;
export {};
