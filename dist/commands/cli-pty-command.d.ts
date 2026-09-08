import type { ReadStream } from 'node:tty';
export interface PtyCommandOptions {
    cwd?: string;
    signal?: AbortSignal;
    timeoutMs?: number;
    maxChars?: number;
    input?: ReadStream;
    write: (text: string) => void;
    platform?: NodeJS.Platform;
}
/** Local terminal input is forwarded only; it is never returned or recorded. */
export declare function runPtyCommand(command: string, options: PtyCommandOptions): Promise<{
    output: string;
    exitCode: number;
    timedOut: boolean;
}>;
