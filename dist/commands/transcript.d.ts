import type { Command } from 'commander';
export declare function runTranscriptCommand(sessionId: string): Promise<string>;
export declare function registerTranscriptCommands(program: Command): void;
