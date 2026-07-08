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
export declare function endStreamingPhaseForInterruptInOrder(deps: TerminalStreamingInterruptDeps, footerState: TerminalStreamingFooterState): void;
