export interface CrashContext {
    command?: string;
    args?: string[];
    sessionId?: string;
    cwd?: string;
    startupPhase?: string;
}
export type StreamErrorHandler = (error: unknown, stream: NodeJS.WriteStream) => boolean;
export declare function registerCrashOutputRestorer(restore: () => void): () => void;
/**
 * Provider-private task-local reasoning must never be copied into a Node
 * diagnostic report. Xiaok's structured crash report below is the only
 * supported crash artifact and is intentionally allowlist-only.
 */
export declare function configureSafeCrashCapture(): void;
export declare function setCrashContext(ctx: CrashContext): void;
export declare function setStreamErrorHandler(handler: StreamErrorHandler | null): void;
export declare function reportCrash(error: unknown): Promise<string>;
/** One fatal owner: detach transcript capture before any await or diagnostic write. */
export declare function handleFatalError(error: unknown, label?: string): Promise<void>;
export declare function installGlobalCrashHandlers(): void;
