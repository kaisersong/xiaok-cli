export interface TerminalStreamingFooterState {
    inputPrompt: string;
    summaryLine: string;
    statusLine: string;
}
export interface TerminalStreamingBoundaryDeps {
    scrollRegion: {
        isActive(): boolean;
        isContentStreaming(): boolean;
        endContentStreaming(options: TerminalStreamingFooterState): void;
        renderFooter(options: TerminalStreamingFooterState): void;
    };
    replRenderer: {
        prepareForInput(): void;
    };
    mdRenderer: {
        beginNewSegment(): void;
    };
}
export interface TerminalStreamingInterruptDeps {
    scrollRegion: {
        isActive(): boolean;
        isContentStreaming(): boolean;
        endContentStreaming(options: TerminalStreamingFooterState): void;
    };
    runtimeState: {
        enterToolInterrupt(): void;
    };
    mdRenderer: {
        beginNewSegment(): void;
    };
}
export declare function renderFooterChromeInOrder(deps: TerminalStreamingBoundaryDeps, footerState: TerminalStreamingFooterState): void;
export interface TerminalStreamingPhaseDeps {
    scrollRegion: {
        isActive(): boolean;
        isContentStreaming(): boolean;
        clearActivity(): void;
        positionCursorAtContentCursor(): void;
        writeAtContentCursor(text: string): void;
        beginContentStreaming(): void;
        getNewlineCallback(): () => void;
        getColumnAdvanceCallback(): (visibleWidth: number) => void;
    };
    runtimeState: {
        enterStreamingContent(): void;
    };
    turnLayout: {
        consumeAssistantLeadIn(): string;
    };
    mdRenderer: {
        setNewlineCallback(callback: (() => void) | null): void;
        setColumnAdvanceCallback(callback: ((visibleWidth: number) => void) | null): void;
    };
    stopLiveActivityTimer(): void;
    writeFallback(text: string): void;
}
/**
 * Attach the scroll-region-aware cursor bookkeeping callbacks before the next
 * assistant chunk is rendered. Called for every non-empty delta, so the
 * re-entry branch must stay free of absolute repositioning side effects beyond
 * restoring the tracked cursor.
 */
export declare function ensureStreamingPhaseInOrder(deps: TerminalStreamingPhaseDeps): void;
export declare function endStreamingPhaseForInterruptInOrder(deps: TerminalStreamingInterruptDeps, footerState: TerminalStreamingFooterState): void;
