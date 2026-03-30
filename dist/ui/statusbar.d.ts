export type StatusBarField = "model" | "mode" | "tokens" | "session";
export interface UsageStats {
    inputTokens: number;
    outputTokens: number;
    budget?: number;
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
    private fields;
    private enabled;
    private cwd;
    private branch;
    constructor();
    init(model: string, sessionId: string, cwd: string, mode?: string): void;
    update(usage: UsageStats): void;
    updateModel(model: string): void;
    updateMode(mode: string): void;
    updateBranch(branch: string): void;
    setFields(fields: StatusBarField[]): void;
    /** Build the status string (no newline). */
    getStatusLine(): string;
    /** Print the status bar as simple text (no ANSI positioning). */
    render(): void;
    /** No-op — no terminal state to restore in inline mode. */
    destroy(): void;
}
