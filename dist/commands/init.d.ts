import type { Command } from 'commander';
export declare function runInitCommand(cwd: string): Promise<string>;
export declare function registerInitCommands(program: Command): void;
