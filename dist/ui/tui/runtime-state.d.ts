import type { ActivitySnapshot } from '../statusbar.js';
export type TuiTurnSurfaceState = 'input_ready' | 'streaming_content' | 'tool_interrupt' | 'waiting_feedback' | 'busy_finishing' | 'compat_input_ready' | 'compat_streaming';
export type TuiFooterMode = 'input_ready' | 'busy' | 'feedback' | 'compat';
export type TuiSummarySource = 'none' | 'turn' | 'completed_turn' | 'waiting_user';
export interface TuiSurfaceSnapshot {
    turnSurfaceState: TuiTurnSurfaceState;
    footerMode: TuiFooterMode;
    activityVisible: boolean;
    summarySource: TuiSummarySource;
}
interface ReassuranceTick {
    bucket: number;
    line: string;
}
export interface TuiRuntimeStatusBar {
    beginActivity(label: string, startedAt?: number): void;
    updateActivity(label: string): void;
    endActivity(): void;
    clearLive(): void;
    getActivityLabel(): string;
    getActivitySnapshot(): ActivitySnapshot | null;
    getActivityLine(now?: number, frameIndex?: number): string;
    getReassuranceTick(now?: number, lastBucket?: number): ReassuranceTick | null;
}
export interface TuiRuntimeScrollRegion {
    isContentStreaming(): boolean;
    renderActivity(activityLine: string): void;
    clearActivity(): void;
}
export interface TuiRuntimeStateOptions {
    statusBar: TuiRuntimeStatusBar;
    scrollRegion: TuiRuntimeScrollRegion;
    onWriteProgressNote: (note: string) => void;
    onSuspendInteractiveUi: (context: string, error: unknown) => void;
    isTerminalUiSuspended: () => boolean;
}
export declare class TuiRuntimeState {
    private readonly options;
    private liveActivityTimer;
    private resumeActivityTimer;
    private reassuranceTimer;
    private pauseActivityTimer;
    private interactivePromptDepth;
    private liveActivityFrame;
    private liveActivityVisible;
    private responseStarted;
    private lastReassuranceBucket;
    private turnActive;
    private snapshot;
    constructor(options: TuiRuntimeStateOptions);
    getSnapshot(): TuiSurfaceSnapshot;
    setSummarySource(summarySource: TuiSummarySource): void;
    getFooterInputPrompt(): string;
    beginTurn(activityLabel?: string): void;
    noteResponseStarted(): void;
    enterStreamingContent(): void;
    enterToolInterrupt(): void;
    enterWaitingFeedback(): void;
    markBusyFinishing(): void;
    markInputReady(): void;
    markCompatInputReady(): void;
    deactivateTurn(): void;
    beginActivity(label: string, restart?: boolean, startedAt?: number): void;
    scheduleActivityResume(label: string, delayMs?: number): void;
    scheduleActivityPause(delayMs?: number): void;
    ensureReassuranceTimer(): void;
    pauseActivity(): void;
    stopLiveActivityTimer(): void;
    withPausedLiveActivity<T>(action: () => Promise<T>): Promise<T>;
    enterInteractivePrompt(): void;
    exitInteractivePrompt(): void;
    stopActivity(): void;
    destroy(): void;
    private renderLiveActivity;
    private clearResumeTimer;
    private clearPauseTimer;
}
export {};
