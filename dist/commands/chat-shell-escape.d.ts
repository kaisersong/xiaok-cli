export type ShellEscapeParseResult = {
    kind: 'command';
    command: string;
} | {
    kind: 'usage';
};
export interface ShellCommandOptions {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    shell?: string;
    platform?: NodeJS.Platform;
}
export interface ShellCommandResult {
    exitCode: number | null;
    signal: NodeJS.Signals | null;
    error?: string;
    output?: string;
}
export interface ShellEscapeExecutorInput {
    command: string;
    cwd: string;
}
export type ShellEscapeExecutor = (input: ShellEscapeExecutorInput) => Promise<ShellCommandResult>;
export declare function parseShellEscapeInput(input: string): ShellEscapeParseResult | null;
export declare function runInteractiveShellCommand(command: string, options?: ShellCommandOptions): Promise<ShellCommandResult>;
