import type { Command } from 'commander';
export declare function runPrCommand(cwd: string): Promise<string>;
export declare function registerPrCommands(program: Command): void;
