import type { Command } from 'commander';
export declare function runReviewCommand(cwd: string): Promise<string>;
export declare function registerReviewCommands(program: Command): void;
