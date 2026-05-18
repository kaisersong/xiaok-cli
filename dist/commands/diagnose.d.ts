import type { Command } from 'commander';
export declare function runDiagnoseTraceCommand(input: {
    tracePath: string;
    format?: 'json' | 'markdown';
}): Promise<string>;
export declare function registerDiagnoseCommands(program: Command): void;
