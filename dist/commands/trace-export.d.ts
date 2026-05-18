import type { Command } from 'commander';
export declare function runTraceExportCommand(input: {
    inputPath?: string;
    sessionId?: string;
    projectId?: string;
    dataRoot?: string;
    projectDetailPath?: string;
    outputPath: string;
    force?: boolean;
}): Promise<string>;
export declare function registerTraceCommands(program: Command): void;
