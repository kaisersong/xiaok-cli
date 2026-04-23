export type StatusBarField = "model" | "mode" | "tokens" | "session";
export interface UsageStats {
    inputTokens: number;
    outputTokens: number;
    cacheCreationInputTokens?: number;
    cacheReadInputTokens?: number;
}
export interface StatusBarOptions {
    contextLimit?: number;
}
export interface ActivitySnapshot {
    label: string;
    startedAt: number;
}
interface ReassuranceTick {
    bucket: number;
    line: string;
}
/**
 * Inline status bar — prints a status line after input prompt.
 * No ANSI scroll regions, no absolute cursor positioning.
 */
export declare class StatusBar {
    private model;
    private sessionId;
    private mode;
    private usage;
    private contextLimit;
    private fields;
    private enabled;
    private cwd;
    private branch;
    private activity;
    constructor();
    init(model: string, sessionId: string, cwd: string, mode?: string, options?: StatusBarOptions): void;
    update(usage: UsageStats): void;
    updateModel(model: string): void;
    updateMode(mode: string): void;
    updateBranch(branch: string): void;
    setFields(fields: StatusBarField[]): void;
    beginActivity(label: string, startedAt?: number): void;
    updateActivity(label: string): void;
    endActivity(): void;
    getActivityLabel(): string;
    getActivitySnapshot(): ActivitySnapshot | null;
    /** Build the status string (no newline). */
    getStatusLine(): string;
    getLiveStatusLine(now?: number, frameIndex?: number): string;
    getActivityLine(now?: number, frameIndex?: number): string;
    getReassuranceTick(now?: number, lastBucket?: number): ReassuranceTick | null;
    renderLive(now?: number, frameIndex?: number): void;
    clearLive(): void;
    private getStatusText;
    /** Print the status bar as simple text (no ANSI positioning). */
    render(): void;
    /** No-op — no terminal state to restore in inline mode. */
    destroy(): void;
}
export {};
