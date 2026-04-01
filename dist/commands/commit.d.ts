import type { Command } from 'commander';
export declare function runCommitCommand(cwd: string, message?: string): Promise<string>;
export declare function registerCommitCommands(program: Command): void;
