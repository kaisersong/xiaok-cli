export type StatusBarField = "model" | "mode" | "tokens" | "session";
export interface UsageStats {
    inputTokens: number;
    outputTokens: number;
}
export declare class StatusBar {
    private model;
    private sessionId;
    private mode;
    private usage;
    private fields;
    private enabled;
    private welcomeLines;
    constructor();
    /** Initialize status bar. */
    init(model: string, sessionId: string, mode?: string, welcomeLines?: number): void;
    /** Update usage stats. */
    update(usage: UsageStats): void;
    updateModel(model: string): void;
    updateMode(mode: string): void;
    setFields(fields: StatusBarField[]): void;
    render(): void;
    /** Restore terminal state. */
    destroy(): void;
}
