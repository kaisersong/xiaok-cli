import type { Command } from 'commander';
export interface TranscriptCommandOptions {
    gzip?: boolean;
    olderThanDays?: number;
}
export declare function runTranscriptCommand(sessionId: string, options?: TranscriptCommandOptions): Promise<string>;
export declare function registerTranscriptCommands(program: Command): void;
