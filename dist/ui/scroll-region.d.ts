/**
 * Scroll region manager for terminal output.
 *
 * Uses ANSI scroll regions to keep input area and status bar fixed at bottom
 * while content + live activity scroll in the upper region.
 *
 * Layout:
 * ┌──────────────────────────────────┐
 * │                                  │
 * │   Output content                 │  ← Scroll region (rows 1 to rows-footerHeight-gapHeight)
 * │   (markdown, tools, etc)         │
 * │                                  │
 * │ ⠴ Thinking(4m 12s • esc to int)  │  ← Live activity (bottom of scroll)
 * │                                  │  ← Gap row (empty)
 * ├──────────────────────────────────┤
 * │ ❯ working...                     │  ← Input bar (fixed footer row 1)
 * │ gpt-5.4 · 0% · master · xiaok-cli│  ← Status bar (fixed footer row 2)
 * └──────────────────────────────────┘
 */
export interface ScrollRegionConfig {
    /** Height of fixed footer (input bar + status bar) */
    footerHeight: number;
    /** Empty gap row between activity line and input bar */
    gapHeight: number;
    /** Terminal rows */
    rows: number;
    /** Terminal columns */
    columns: number;
}
export interface ScrollPromptFrame {
    inputValue: string;
    cursor: number;
    placeholder: string;
    statusLine: string;
    overlayLines?: string[];
}
export declare class ScrollRegionManager {
    private readonly stream;
    private active;
    private config;
    private lastActivityLine;
    private lastInputPrompt;
    private lastStatusLine;
    private lastInputValue;
    private lastInputCursor;
    private lastOverlayRenderRows;
    /** Number of terminal rows the welcome screen occupies. */
    private _welcomeRows;
    /** Total content rows written since begin() (including welcome). */
    private _totalRows;
    /** Whether content is currently being streamed. */
    private _contentStreaming;
    /** Whether any markdown content has been streamed yet. */
    private _hasStreamedContent;
    /** Footer is currently visible on screen. */
    private _footerVisible;
    /** Tracks if we have already pushed past the welcome screen. */
    private _pastWelcome;
    /** Last row containing content (before footer). Updated at end of streaming. */
    private _contentEndRow;
    /** Actual terminal cursor row (1-based), tracked by counting \n writes. */
    private _cursorRow;
    /** Actual terminal cursor column (0-based), for wrapping calculation. */
    private _cursorCol;
    /** Internal flag: cursor position may be unreliable (just after screen clear). */
    private _cursorUncertain;
    /** Content row where the current markdown streaming block began. */
    private _streamStartRow;
    /** Number of rows currently occupied by the input editor above status. */
    private lastInputRenderRows;
    constructor(stream?: NodeJS.WriteStream, config?: ScrollRegionConfig);
    private clampCursorRow;
    private maxInputRows;
    /**
     * Calculate the bottom row of the scroll region (where activity line renders).
     */
    private getScrollBottom;
    /**
     * Calculate the input bar row where the last input line sits.
     */
    private getInputBarRow;
    private getInputStartRow;
    /**
     * Calculate the status bar row (fixed footer bottom row).
     */
    private getStatusBarRow;
    private getOverlayVisibleLines;
    /**
     * Calculate cursor column after the "❯ " prefix.
     * "❯" is at column 1, space at column 2, text starts at column 3.
     */
    private getCursorBase;
    private getFooterTextWidth;
    private wrapFooterLine;
    private getFooterInputState;
    /**
     * Update terminal size.
     */
    updateSize(rows: number, columns: number): void;
    /**
     * Activate scroll region mode.
     * Clears the screen and moves cursor to top,
     * so the welcome screen fills the entire visible area.
     */
    begin(): void;
    /**
     * Deactivate scroll region mode.
     * Restores normal terminal scrolling and clears footer area.
     */
    end(): void;
    /**
     * Check if scroll region is active.
     */
    isActive(): boolean;
    renderPromptFrame(frame: ScrollPromptFrame): void;
    /**
     * Render input in the fixed footer area.
     * This should be called when user types during streaming.
     * @param inputValue - The current input value (may contain newlines)
     * @param cursor - Cursor position in the input value
     */
    renderInput(inputValue: string, cursor: number): void;
    /**
     * Update the footer content (input prompt and status line).
     * Call this when the activity label changes or to update status.
     * This only updates the status line, not the input bar.
     * After rendering, cursor is positioned at input line for typing.
     */
    updateFooter(inputPrompt: string, statusLine?: string): void;
    /**
     * Render the footer area (input prompt + status bar).
     * Status bar shows static info like model, percentage, branch, project.
     * After rendering, cursor is positioned at input line for user typing.
     */
    renderFooter(options?: {
        inputPrompt?: string;
        statusLine?: string;
    }): void;
    private renderOverlayPromptFrame;
    private positionCursorForOverlayInput;
    /**
     * Position the cursor in the input bar for typing.
     * When showing a placeholder (no user input), cursor goes to column 3 (after "❯ ").
     * When showing user input, cursor goes to the actual cursor position.
     */
    private positionCursorForInput;
    /**
     * Clear the last input value.
     * Call this after user submits input so the footer shows placeholder during turn.
     */
    clearLastInput(): void;
    /**
     * Clear the activity line at the bottom of the scroll region.
     * Call this after user input is written, before AI response starts.
     * Does NOT reposition the cursor — content continues from current position.
     */
    clearActivityLine(): void;
    /**
     * Position cursor for content output, based on how many rows of content
     * were written. Calculates the actual end row (accounting for terminal
     * wrapping) and positions cursor there + 1 for a gap row.
     */
    positionAfterContent(contentRows?: number): void;
    /**
     * Prepare for content output.
     * Clears the activity line at the bottom of the scroll region and positions
     * the cursor there for content to begin.
     * Call this before writing any content to the scroll region.
     */
    beginContentStreaming(): void;
    /**
     * Restore footer after content streaming completes.
     */
    endContentStreaming(options?: {
        inputPrompt?: string;
        statusLine?: string;
    }): void;
    /**
     * Prepare for content output.
     * Clears the activity line so content can be output without overlap.
     * Call this before writing any content to the scroll region.
     */
    prepareForContent(): void;
    /**
     * Render live activity in the scroll region (not footer).
     * Activity line shows at bottom of scroll region, above the gap row.
     *
     * This method only updates the activity line. Cursor stays at activity line
     * after rendering - do NOT use [s/[u as it resets attributes.
     */
    renderActivity(activityLine: string): void;
    /**
     * Clear activity line from scroll region.
     * Cursor stays at activity line after clearing.
     */
    clearActivity(): void;
    /**
     * Update status line only (without re-rendering everything).
     */
    updateStatusLine(statusLine: string): void;
    /**
     * Set the scroll region ANSI sequence.
     */
    private setScrollRegion;
    /**
     * Pad a line to fill the terminal width (clears any remaining characters).
     * If hasBackground is true, the padding will have the background color.
     */
    isContentStreaming(): boolean;
    getPromptFrameState(): ScrollPromptFrame;
    setWelcomeRows(rows: number): void;
    clearContentArea(): void;
    advanceContentCursor(rows: number): void;
    setContentCursor(row: number): void;
    getContentCursor(): number;
    get maxContentRows(): number;
    writeAtContentCursor(text: string): void;
    writeSubmittedInput(text: string): void;
    getNewlineCallback(): (() => void);
    syncContentCursorFromRenderedLines(lines: string[]): void;
    private padLine;
    /**
     * Pad a line with background color to fill the terminal width.
     * The line should already have background set. Adds spaces and resets.
     */
    private padLineWithBg;
}
