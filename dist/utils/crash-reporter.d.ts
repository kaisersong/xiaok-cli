export interface CrashContext {
    command?: string;
    args?: string[];
    sessionId?: string;
    cwd?: string;
}
export type StreamErrorHandler = (error: unknown, stream: NodeJS.WriteStream) => boolean;
export declare function setCrashContext(ctx: CrashContext): void;
export declare function setStreamErrorHandler(handler: StreamErrorHandler | null): void;
export declare function reportCrash(error: unknown): Promise<string>;
export declare function installGlobalCrashHandlers(): void;
