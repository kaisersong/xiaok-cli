/**
 * Scroll region manager for terminal output.
 *
 * Uses ANSI scroll regions to keep input area and status bar fixed at bottom
 * while content + live activity scroll in the upper region.
 *
 * Layout:
 * ┌──────────────────────────────────┐
 * │                                  │
 * │   Output content                 │  ← Scroll region (rows 1 to rows-2)
 * │   (markdown, tools, etc)         │
 * │                                  │
 * │ ⠴ Thinking(4m 12s • esc to int)  │  ← Live activity (bottom of scroll)
 * ├──────────────────────────────────┤
 * │ ❯ working...                     │  ← Input bar (fixed footer row 1)
 * │ gpt-5.4 · 0% · master · xiaok-cli│  ← Status bar (fixed footer row 2)
 * └──────────────────────────────────┘
 */
export interface ScrollRegionConfig {
    /** Height of fixed footer (input bar + status bar) */
    footerHeight: number;
    /** Terminal rows */
    rows: number;
    /** Terminal columns */
    columns: number;
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
    constructor(stream?: NodeJS.WriteStream, config?: ScrollRegionConfig);
    /**
     * Update terminal size.
     */
    updateSize(rows: number, columns: number): void;
    /**
     * Activate scroll region mode.
     * Sets up the scroll region. Footer is rendered separately by beginActivity().
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
    /**
     * Prepare for content output.
     * Clears the activity line so content can be output without overlap.
     * Call this before writing any content to the scroll region.
     */
    prepareForContent(): void;
    /**
     * Render live activity in the scroll region (not footer).
     * Activity line shows at bottom of scroll region, above the input bar.
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
    private padLine;
    /**
     * Pad a line with background color to fill the terminal width.
     * The line should already have background set. Adds spaces and resets.
     */
    private padLineWithBg;
    /**
     * Get visible length of a string (ignoring ANSI codes).
     */
    private getVisibleLength;
}
