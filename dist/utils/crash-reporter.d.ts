export interface CrashContext {
    command?: string;
    args?: string[];
    sessionId?: string;
    cwd?: string;
}
export type StreamErrorHandler = (error: unknown, stream: NodeJS.WriteStream) => boolean;
/**
 * Provider-private task-local reasoning must never be copied into a Node
 * diagnostic report. Xiaok's structured crash report below is the only
 * supported crash artifact and is intentionally allowlist-only.
 */
export declare function configureSafeCrashCapture(): void;
export declare function setCrashContext(ctx: CrashContext): void;
export declare function setStreamErrorHandler(handler: StreamErrorHandler | null): void;
export declare function reportCrash(error: unknown): Promise<string>;
export declare function installGlobalCrashHandlers(): void;
