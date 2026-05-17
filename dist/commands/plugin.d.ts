import type { Command } from 'commander';
export declare function runInstall(name: string, opts: {
    registry?: string;
    force?: boolean;
}): Promise<void>;
export declare function runList(): void;
export declare function runSearch(query?: string, opts?: {
    registry?: string;
}): Promise<void>;
export declare function runUninstall(name: string): void;
export declare function registerPluginCommands(program: Command): void;
