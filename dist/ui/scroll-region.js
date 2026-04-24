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
 * │                                  │  ← Gap row (empty)
 * │                                  │  ← Input background padding row
 * ├──────────────────────────────────┤
 * │ ❯ working...                     │  ← Input bar text row
 * │ gpt-5.4 · 0% · master · xiaok-cli│  ← Status bar (fixed footer bottom row)
 * └──────────────────────────────────┘
 */
import { getDisplayWidth, splitSymbols, stripAnsi } from './text-metrics.js';
const RESET_SCROLL_REGION = '\x1b[r';
const SET_SCROLL_REGION = '\x1b[1;%dr';
const CLEAR_LINE = '\x1b[2K';
const HIDE_CURSOR = '\x1b[?25l';
const SHOW_CURSOR = '\x1b[?25h';
const MOVE_TO_ROW = '\x1b[%d;1H';
// Cursor movement
const CURSOR_DOWN_999 = '\x1b[999B';
const CURSOR_UP = '\x1b[%dA';
const CURSOR_HOME = '\r';
// Input bar styling
const INPUT_BG = '\x1b[48;5;238m'; // Darker gray background
const PROMPT_FG = '\x1b[1;36m'; // Bold cyan for ❯
const RESET_FG = '\x1b[22;39m'; // Reset bold + fg, keep bg
const RESET_ALL = '\x1b[0m';
const DIM = '\x1b[2m';
const MAX_INPUT_ROWS = 6;
const INPUT_PADDING_ROWS = 1;
function shouldCompactSubmittedInputForWindowsTmux() {
    return process.platform === 'win32' && Boolean(process.env.TMUX);
}
function shouldSkipPermissionOverlayReserve() {
    return process.platform === 'win32' && Boolean(process.env.TMUX);
}
function getFooterPromptGlyph() {
    return shouldCompactSubmittedInputForWindowsTmux() ? '>' : '❯';
}
function getSafeRenderWidth(width) {
    const margin = shouldCompactSubmittedInputForWindowsTmux() ? 2 : 1;
    return Math.max(1, width - margin);
}
export class ScrollRegionManager {
    stream;
    active = false;
    config;
    lastActivityLine = '';
    lastActivityRow = null;
    lastInputPrompt = '';
    lastSummaryLine = '';
    lastStatusLine = '';
    lastInputValue = '';
    lastInputCursor = 0;
    lastOverlayRenderRows = 0;
    /** Number of terminal rows the welcome screen occupies. */
    _welcomeRows = 0;
    /** Total content rows written since begin() (including welcome). */
    _totalRows = 0;
    /** Whether content is currently being streamed. */
    _contentStreaming = false;
    /** Whether any markdown content has been streamed yet. */
    _hasStreamedContent = false;
    /** Whether a renderer-owned permission overlay currently owns the prompt/footer area. */
    _overlayPromptVisible = false;
    /** Active overlay kind currently rendered above the footer input, if any. */
    _activeOverlayKind = null;
    /** Which subsystem last rendered the active overlay. */
    _activeOverlayOwner = null;
    /** Footer is currently visible on screen. */
    _footerVisible = false;
    /** Tracks if we have already pushed past the welcome screen. */
    _pastWelcome = false;
    /** Last row containing content (before footer). Updated at end of streaming. */
    _contentEndRow = 0;
    /** Actual terminal cursor row (1-based), tracked by counting \n writes. */
    _cursorRow = 1;
    /** Actual terminal cursor column (0-based), for wrapping calculation. */
    _cursorCol = 0;
    /** Internal flag: cursor position may be unreliable (just after screen clear). */
    _cursorUncertain = false;
    /** Content row where the current markdown streaming block began. */
    _streamStartRow = 1;
    /** Number of rows currently occupied by the input editor above status. */
    lastInputRenderRows = 1 + INPUT_PADDING_ROWS;
    /** Last screen rows occupied by footer/overlay chrome, used to clear stale rows after terminal resize. */
    lastFooterClearStartRow = 0;
    lastFooterClearEndRow = 0;
    constructor(stream = process.stdout, config) {
        this.stream = stream;
        const rows = stream.rows ?? 24;
        const columns = stream.columns ?? 80;
        this.config = config ?? {
            footerHeight: 3, // Input padding row + input bar + status bar
            gapHeight: 2, // Empty gap between transcript/activity/overlay and input bar
            rows,
            columns,
        };
    }
    clampCursorRow(row) {
        return Math.max(1, Math.min(row, this.getScrollBottom()));
    }
    maxInputRows() {
        return Math.max(1, Math.min(MAX_INPUT_ROWS, this.config.rows - this.config.gapHeight - 4));
    }
    countFooterLineRows(text) {
        if (!text) {
            return 0;
        }
        const cols = Math.max(1, this.config.columns);
        return Math.max(1, Math.ceil(getDisplayWidth(stripAnsi(text)) / cols));
    }
    getSummaryReserveRows(summaryLine = this.lastSummaryLine) {
        return this.countFooterLineRows(summaryLine);
    }
    getSummaryStartRow(inputStartRow, summaryLine = this.lastSummaryLine) {
        const summaryRows = this.getSummaryReserveRows(summaryLine);
        if (summaryRows <= 0) {
            return -1;
        }
        return Math.max(1, inputStartRow - 1 - summaryRows);
    }
    getScrollBottomForLayout(inputFrameRows, overlayRows, summaryLine) {
        const summaryReserveRows = this.getSummaryReserveRows(summaryLine);
        const reservedRowsAboveInput = overlayRows > 0
            ? overlayRows + this.config.gapHeight + summaryReserveRows
            : this.config.gapHeight + summaryReserveRows;
        return Math.max(1, this.getInputStartRow(inputFrameRows) - reservedRowsAboveInput - 1);
    }
    /**
     * Calculate the bottom row of the scroll region (where activity line renders).
     */
    getScrollBottom() {
        return this.getScrollBottomForLayout(this.lastInputRenderRows, this.lastOverlayRenderRows, this.lastSummaryLine);
    }
    /**
     * Calculate the input bar row where the last input line sits.
     */
    getInputBarRow() {
        return this.getStatusBarRow() - 1;
    }
    getInputFrameRows(inputRows = 1) {
        return inputRows + INPUT_PADDING_ROWS;
    }
    getInputStartRow(frameRows = this.lastInputRenderRows) {
        return Math.max(1, this.getInputBarRow() - frameRows + 1);
    }
    getInputTextStartRow(inputRows) {
        return this.getInputStartRow(this.getInputFrameRows(inputRows)) + INPUT_PADDING_ROWS;
    }
    /**
     * Calculate the status bar row (fixed footer bottom row).
     */
    getStatusBarRow() {
        return this.config.rows;
    }
    getOverlayVisibleLines(lines, inputRows) {
        const inputFrameRows = this.getInputFrameRows(inputRows);
        const maxOverlayRows = Math.max(0, this.config.rows - inputFrameRows - 1 - this.config.gapHeight - this.getSummaryReserveRows());
        if (maxOverlayRows <= 0) {
            return [];
        }
        return lines.slice(-maxOverlayRows);
    }
    hasActiveOverlayPrompt() {
        return this.lastOverlayRenderRows > 0 && this._activeOverlayKind !== null;
    }
    isRendererPermissionOverlayActive() {
        return this._activeOverlayKind === 'permission' && this._activeOverlayOwner === 'renderer';
    }
    clearActiveOverlayPrompt() {
        this._overlayPromptVisible = false;
        this._activeOverlayKind = null;
        this._activeOverlayOwner = null;
    }
    clearScreenRow(row) {
        this.stream.write(`\x1b[${row};1H${CLEAR_LINE}`);
    }
    getClearScreenRowSequence(row) {
        return `\x1b[${row};1H${CLEAR_LINE}`;
    }
    composeActivityLineRender(activityLine) {
        const previousActivityRow = this.lastActivityRow;
        const scrollBottom = this.getScrollBottom();
        const cols = this.config.columns;
        let output = '';
        if (previousActivityRow !== null && previousActivityRow !== scrollBottom) {
            output += `${MOVE_TO_ROW.replace('%d', String(previousActivityRow))}${CLEAR_LINE}`;
        }
        output += `${MOVE_TO_ROW.replace('%d', String(scrollBottom))}${CLEAR_LINE}${this.padLine(activityLine, cols, false)}`;
        this.lastActivityRow = scrollBottom;
        return output;
    }
    clearRenderedFooterRows() {
        const fallbackStart = this.getInputStartRow();
        const fallbackEnd = this.getStatusBarRow();
        const start = this.lastFooterClearStartRow || fallbackStart;
        const end = this.lastFooterClearEndRow || fallbackEnd;
        for (let row = Math.max(1, start); row <= Math.max(start, end); row += 1) {
            this.clearScreenRow(row);
        }
    }
    /**
     * Calculate cursor column after the "❯ " prefix.
     * "❯" is at column 1, space at column 2, text starts at column 3.
     */
    getCursorBase() {
        return 3;
    }
    getFooterTextWidth() {
        return Math.max(1, this.config.columns - this.getCursorBase() + 1);
    }
    wrapFooterLine(line, maxWidth, cursorSentinel) {
        const wrapped = [];
        const symbols = splitSymbols(line);
        let current = '';
        let currentWidth = 0;
        let currentCursorColumn;
        const pushCurrent = () => {
            wrapped.push({
                text: current,
                cursorColumn: currentCursorColumn,
            });
            current = '';
            currentWidth = 0;
            currentCursorColumn = undefined;
        };
        for (const symbol of symbols) {
            if (symbol === cursorSentinel) {
                if (currentWidth >= maxWidth) {
                    pushCurrent();
                }
                currentCursorColumn = currentWidth;
                continue;
            }
            const symbolWidth = Math.max(1, getDisplayWidth(symbol));
            if (current !== '' && currentWidth + symbolWidth > maxWidth) {
                pushCurrent();
            }
            current += symbol;
            currentWidth += symbolWidth;
        }
        if (current.length > 0 || currentCursorColumn !== undefined || wrapped.length === 0) {
            pushCurrent();
        }
        return wrapped;
    }
    getFooterInputState(inputValue, cursor) {
        const cursorSentinel = '\uFFF0';
        const safeCursor = Math.max(0, Math.min(cursor, inputValue.length));
        const inputWithCursor = `${inputValue.slice(0, safeCursor)}${cursorSentinel}${inputValue.slice(safeCursor)}`;
        const rawLines = inputWithCursor.split('\n');
        const wrappedLines = [];
        const maxWidth = this.getFooterTextWidth();
        let cursorVisualLine = 0;
        let cursorColumn = 0;
        rawLines.forEach((line) => {
            const wrapped = this.wrapFooterLine(line, maxWidth, cursorSentinel);
            wrapped.forEach((entry) => {
                if (entry.cursorColumn !== undefined) {
                    cursorVisualLine = wrappedLines.length;
                    cursorColumn = entry.cursorColumn;
                }
                wrappedLines.push(entry.text);
            });
        });
        const maxRows = this.maxInputRows();
        const maxStart = Math.max(0, wrappedLines.length - maxRows);
        const visibleStart = Math.min(Math.max(0, cursorVisualLine - maxRows + 1), maxStart);
        const visibleLines = wrappedLines.slice(visibleStart, visibleStart + maxRows);
        return {
            visibleStart,
            visibleLines,
            cursorVisualLine,
            cursorColumn,
        };
    }
    /**
     * Update terminal size.
     */
    updateSize(rows, columns) {
        if (this.active) {
            this.stream.write(RESET_SCROLL_REGION);
            this.clearRenderedFooterRows();
        }
        this.config = { ...this.config, rows, columns };
        if (this.active) {
            // Re-apply scroll region with new size
            this.setScrollRegion();
            this.renderFooter();
        }
    }
    /**
     * Activate scroll region mode.
     * Clears the screen and moves cursor to top,
     * so the welcome screen fills the entire visible area.
     */
    begin() {
        if (this.active)
            return;
        this.active = true;
        this.lastActivityLine = '';
        this.lastActivityRow = null;
        this.lastInputPrompt = '';
        this.lastInputValue = '';
        this.lastInputCursor = 0;
        this.lastSummaryLine = '';
        this.lastStatusLine = '';
        this.lastInputRenderRows = this.getInputFrameRows(1);
        this.lastFooterClearStartRow = 0;
        this.lastFooterClearEndRow = 0;
        this.clearActiveOverlayPrompt();
        // Set scroll region (rows 1 to scrollBottom)
        this.setScrollRegion();
        // Clear entire screen and move cursor to top-left.
        // \x1b[2J clears all lines, \x1b[H homes the cursor.
        // This pushes the shell command that launched the CLI off screen.
        this.stream.write(`\x1b[2J\x1b[H`);
        // Don't render footer here - it will be rendered by beginActivity()
    }
    /**
     * Deactivate scroll region mode.
     * Restores normal terminal scrolling and clears footer area.
     */
    end() {
        if (!this.active)
            return;
        this.active = false;
        // Reset scroll region to full terminal
        this.stream.write(RESET_SCROLL_REGION);
        // Clear footer area: status row plus currently expanded input rows.
        this.stream.write(CURSOR_DOWN_999);
        this.stream.write(CLEAR_LINE);
        for (let row = 0; row < this.lastInputRenderRows; row += 1) {
            this.stream.write(`${CURSOR_UP.replace('%d', '1')}${CLEAR_LINE}`);
        }
        // Move cursor to after the last content line
        this.stream.write(CURSOR_UP.replace('%d', '2'));
        this.stream.write('\n');
        this.lastActivityLine = '';
        this.lastActivityRow = null;
        this.lastInputPrompt = '';
        this.lastInputValue = '';
        this.lastStatusLine = '';
        this.lastSummaryLine = '';
        this.lastFooterClearStartRow = 0;
        this.lastFooterClearEndRow = 0;
        this.clearActiveOverlayPrompt();
    }
    /**
     * Check if scroll region is active.
     */
    isActive() {
        return this.active;
    }
    renderPromptFrame(frame) {
        if (!this.active)
            return;
        const owner = frame.owner ?? 'input';
        this.lastInputValue = frame.inputValue;
        this.lastInputCursor = frame.cursor;
        this.lastInputPrompt = frame.placeholder;
        this.lastSummaryLine = frame.summaryLine ?? '';
        this.lastStatusLine = frame.statusLine;
        if ((frame.overlayLines?.length ?? 0) > 0) {
            this._activeOverlayKind = frame.overlayKind ?? 'generic';
            this._activeOverlayOwner = owner;
            this._overlayPromptVisible = this.isRendererPermissionOverlayActive();
            this.renderOverlayPromptFrame(frame);
            return;
        }
        if (this.isRendererPermissionOverlayActive() && owner !== 'renderer') {
            return;
        }
        this.clearActiveOverlayPrompt();
        this.renderFooter({
            inputPrompt: frame.placeholder,
            summaryLine: frame.summaryLine,
            statusLine: frame.statusLine,
        });
        this.lastOverlayRenderRows = 0;
    }
    /**
     * Render input in the fixed footer area.
     * This should be called when user types during streaming.
     * @param inputValue - The current input value (may contain newlines)
     * @param cursor - Cursor position in the input value
     */
    renderInput(inputValue, cursor) {
        if (!this.active) {
            // Not in scroll region mode, use inline rendering
            const cursorWidth = getDisplayWidth(inputValue.slice(0, cursor));
            const cursorCol = this.getCursorBase() + cursorWidth;
            this.stream.write(`\r${CLEAR_LINE}${INPUT_BG}${PROMPT_FG}❯${RESET_FG} ${inputValue}${RESET_ALL}`);
            this.stream.write(`\x1b[1;${cursorCol}H`);
            return;
        }
        this.lastInputValue = inputValue;
        this.lastInputCursor = cursor;
        this.renderFooter();
    }
    /**
     * Update the footer content (input prompt and status line).
     * Call this when the activity label changes or to update status.
     * This only updates the status line, not the input bar.
     * After rendering, cursor is positioned at input line for typing.
     */
    updateFooter(inputPrompt, summaryLine, statusLine) {
        if (!this.active)
            return;
        this.lastInputPrompt = inputPrompt;
        if (summaryLine !== undefined) {
            this.lastSummaryLine = summaryLine;
        }
        if (statusLine !== undefined) {
            this.lastStatusLine = statusLine;
        }
        const inputStartRow = this.getInputStartRow();
        const summaryStartRow = this.getSummaryStartRow(inputStartRow, this.lastSummaryLine);
        const summaryRows = this.getSummaryReserveRows(this.lastSummaryLine);
        const statusBarRow = this.getStatusBarRow();
        if (summaryStartRow >= 1) {
            for (let row = summaryStartRow; row < summaryStartRow + summaryRows; row += 1) {
                this.stream.write(`${MOVE_TO_ROW.replace('%d', String(row))}${CLEAR_LINE}`);
            }
            if (this.lastSummaryLine) {
                this.stream.write(`${MOVE_TO_ROW.replace('%d', String(summaryStartRow))}`);
                this.stream.write(this.lastSummaryLine);
            }
        }
        this.stream.write(`${MOVE_TO_ROW.replace('%d', String(statusBarRow))}${CLEAR_LINE}`);
        if (statusLine) {
            this.stream.write(DIM + statusLine + RESET_ALL);
        }
        // Position cursor at input line for typing
        this.positionCursorForInput();
    }
    /**
     * Render the footer area (input prompt + status bar).
     * Status bar shows static info like model, percentage, branch, project.
     * After rendering, cursor is positioned at input line for user typing.
     */
    renderFooterFrame(options, restoreActivity, footerOnly = false) {
        if (!this.active)
            return;
        this._footerVisible = true;
        const cols = this.config.columns;
        const previousInputRows = this.lastInputRenderRows;
        const previousOverlayRows = this.lastOverlayRenderRows;
        const previousSummaryLine = this.lastSummaryLine;
        const previousScrollBottom = this.getScrollBottomForLayout(previousInputRows, previousOverlayRows, previousSummaryLine);
        // Use inputPrompt as a placeholder text when no user input
        const inputPrompt = options?.inputPrompt ?? this.lastInputPrompt ?? 'waiting...';
        const summaryLine = options?.summaryLine ?? this.lastSummaryLine ?? '';
        const statusLine = options?.statusLine ?? this.lastStatusLine ?? '';
        // Update cached values
        if (options?.inputPrompt)
            this.lastInputPrompt = options.inputPrompt;
        if (options?.summaryLine !== undefined)
            this.lastSummaryLine = options.summaryLine;
        if (options?.statusLine)
            this.lastStatusLine = options.statusLine;
        const inputState = this.lastInputValue
            ? this.getFooterInputState(this.lastInputValue, this.lastInputCursor)
            : undefined;
        const inputLines = inputState?.visibleLines ?? [inputPrompt];
        const inputRows = Math.max(1, inputLines.length);
        const inputFrameRows = this.getInputFrameRows(inputRows);
        const isPlaceholder = !this.lastInputValue;
        const nextScrollBottom = this.getScrollBottomForLayout(inputFrameRows, 0, summaryLine);
        // Use absolute row positioning instead of cursor-down-999 which may be
        // unreliable in some terminals. Calculate exact footer rows.
        const statusBarRow = this.getStatusBarRow();
        const previousInputStartRow = this.getInputStartRow(previousInputRows);
        const inputStartRow = this.getInputStartRow(inputFrameRows);
        const inputTextStartRow = inputStartRow + INPUT_PADDING_ROWS;
        const inputEndRow = this.getInputBarRow();
        // Reset scroll region to allow writing to footer area. Batch the footer
        // redraw into a single terminal write so prompt/status don't flicker apart.
        let footerOutput = `${RESET_SCROLL_REGION}${SHOW_CURSOR}`;
        // Clear previous and current editor rows. This prevents stale rows when
        // the input grows or shrinks between redraws.
        const previousOverlayStartRow = previousOverlayRows > 0
            ? Math.max(1, previousInputStartRow - previousOverlayRows - this.config.gapHeight - this.getSummaryReserveRows(previousSummaryLine))
            : previousInputStartRow;
        const footerClearStartRow = Math.max(1, inputStartRow - this.config.gapHeight - this.getSummaryReserveRows(summaryLine));
        const transientClearStartRow = previousOverlayRows > 0
            ? Math.max(1, this._cursorRow + 1)
            : previousOverlayStartRow;
        const clearStartRow = footerOnly
            ? footerClearStartRow
            : Math.max(1, Math.min(previousOverlayStartRow, footerClearStartRow, transientClearStartRow));
        this.reserveTranscriptRows(nextScrollBottom, previousScrollBottom);
        for (let row = clearStartRow; row <= inputEndRow; row += 1) {
            footerOutput += this.getClearScreenRowSequence(row);
        }
        if (shouldCompactSubmittedInputForWindowsTmux()) {
            footerOutput += SET_SCROLL_REGION.replace('%d', String(this.getScrollBottom()));
            for (let row = clearStartRow; row <= statusBarRow; row += 1) {
                footerOutput += this.getClearScreenRowSequence(row);
            }
        }
        for (let index = 0; index < INPUT_PADDING_ROWS; index += 1) {
            const row = inputStartRow + index;
            footerOutput += `\x1b[${row};1H${CLEAR_LINE}`;
            footerOutput += this.padBackgroundRow(cols);
        }
        const summaryStartRow = this.getSummaryStartRow(inputStartRow, summaryLine);
        if (summaryStartRow >= 1 && summaryLine) {
            footerOutput += `\x1b[${summaryStartRow};1H`;
            footerOutput += summaryLine;
        }
        inputLines.forEach((line, index) => {
            const row = inputTextStartRow + index;
            const prefix = index === 0
                ? `${INPUT_BG}${PROMPT_FG}${getFooterPromptGlyph()}${RESET_FG} `
                : `${INPUT_BG}  `;
            footerOutput += `\x1b[${row};1H${CLEAR_LINE}`;
            if (isPlaceholder) {
                footerOutput += this.padLineWithBg(`${prefix}${DIM}${line}`, cols);
            }
            else {
                footerOutput += this.padLineWithBg(`${prefix}${line}`, cols);
            }
        });
        // Status bar (bottom row) is rendered last so any footer-line wrap quirks
        // in the input editor cannot leave stale status text above it.
        footerOutput += `\x1b[${statusBarRow};1H${CLEAR_LINE}`;
        if (statusLine) {
            footerOutput += statusLine;
        }
        this.lastInputRenderRows = inputFrameRows;
        this.lastOverlayRenderRows = 0;
        this.lastFooterClearStartRow = clearStartRow;
        this.lastFooterClearEndRow = statusBarRow;
        // Restore scroll region. Windows tmux is sensitive to applying DECSTBM
        // after writing the footer rows, so keep the region active before footer
        // output on that path and skip the second application here.
        if (!shouldCompactSubmittedInputForWindowsTmux()) {
            footerOutput += SET_SCROLL_REGION.replace('%d', String(this.getScrollBottom()));
        }
        if (restoreActivity && this.lastActivityLine && !this._contentStreaming && !this.hasActiveOverlayPrompt()) {
            footerOutput += this.composeActivityLineRender(this.lastActivityLine);
        }
        this.stream.write(footerOutput);
        // Position cursor after restoring the scroll region. Some terminals move
        // the cursor when DECSTBM is applied, so this must be the final cursor op.
        this.positionCursorForInput();
    }
    renderFooter(options) {
        this.renderFooterFrame(options, true);
    }
    reserveTranscriptRows(nextScrollBottom, previousScrollBottom) {
        const clampedCurrentBottom = Math.max(1, previousScrollBottom);
        const visibleContentRow = Math.max(1, Math.min(this._cursorRow, clampedCurrentBottom));
        const rowsToScroll = Math.max(0, visibleContentRow - nextScrollBottom);
        if (rowsToScroll === 0) {
            return;
        }
        this.stream.write(SET_SCROLL_REGION.replace('%d', String(clampedCurrentBottom)));
        this.stream.write(`${MOVE_TO_ROW.replace('%d', String(clampedCurrentBottom))}`);
        for (let index = 0; index < rowsToScroll; index += 1) {
            this.stream.write('\n');
        }
        this._cursorRow = Math.max(1, this._cursorRow - rowsToScroll);
        this._contentEndRow = Math.max(0, this._contentEndRow - rowsToScroll);
        this._streamStartRow = Math.max(1, this._streamStartRow - rowsToScroll);
        this._cursorUncertain = false;
    }
    renderOverlayPromptFrame(frame) {
        const isPermissionOverlay = frame.overlayKind === 'permission';
        const keepStatusLineVisible = ((isPermissionOverlay && !shouldSkipPermissionOverlayReserve())
            || frame.overlayKind === 'feedback');
        this._footerVisible = isPermissionOverlay || keepStatusLineVisible;
        const cols = this.config.columns;
        const previousInputRows = this.lastInputRenderRows;
        const previousOverlayRows = this.lastOverlayRenderRows;
        const previousScrollBottom = this.getScrollBottom();
        const inputState = this.lastInputValue
            ? this.getFooterInputState(this.lastInputValue, this.lastInputCursor)
            : undefined;
        const inputLines = inputState?.visibleLines ?? [frame.placeholder];
        const inputRows = Math.max(1, inputLines.length);
        const inputFrameRows = this.getInputFrameRows(inputRows);
        const overlayLines = this.getOverlayVisibleLines(frame.overlayLines ?? [], inputRows);
        const overlayRows = overlayLines.length;
        const summaryReserveRows = this.getSummaryReserveRows(frame.summaryLine ?? this.lastSummaryLine);
        const statusBarRow = this.getStatusBarRow();
        const inputStartRow = this.getInputStartRow(inputFrameRows);
        const inputTextStartRow = inputStartRow + INPUT_PADDING_ROWS;
        const overlayStartRow = Math.max(1, inputStartRow - this.config.gapHeight - summaryReserveRows - overlayRows);
        const previousOverlayStartRow = Math.max(1, this.getInputStartRow(previousInputRows) - this.config.gapHeight - this.getSummaryReserveRows() - previousOverlayRows);
        const previousFooterStartRow = Math.max(1, this.getInputStartRow(previousInputRows) - this.config.gapHeight - this.getSummaryReserveRows());
        const clearStartRow = isPermissionOverlay && shouldSkipPermissionOverlayReserve()
            ? 1
            : Math.min(previousOverlayStartRow, overlayStartRow);
        const scrollBottom = Math.max(1, overlayStartRow - 1);
        const isPlaceholder = !this.lastInputValue;
        this.stream.write(RESET_SCROLL_REGION);
        if (isPermissionOverlay) {
            this.stream.write(HIDE_CURSOR);
        }
        else {
            this.stream.write(SHOW_CURSOR);
        }
        for (let row = previousFooterStartRow; row <= statusBarRow; row += 1) {
            this.clearScreenRow(row);
        }
        if (!(isPermissionOverlay && shouldSkipPermissionOverlayReserve())) {
            this.reserveTranscriptRows(scrollBottom, previousScrollBottom);
        }
        this.setScrollRegion(scrollBottom);
        for (let row = clearStartRow; row <= statusBarRow; row += 1) {
            this.clearScreenRow(row);
        }
        overlayLines.forEach((line, index) => {
            const row = overlayStartRow + index;
            this.clearScreenRow(row);
            this.stream.write(this.padLine(line, cols, false));
        });
        for (let row = overlayStartRow + overlayRows; row < inputStartRow; row += 1) {
            this.clearScreenRow(row);
            this.stream.write(this.padLine('', cols, false));
        }
        for (let index = 0; index < INPUT_PADDING_ROWS; index += 1) {
            const row = inputStartRow + index;
            this.clearScreenRow(row);
            this.stream.write(this.padBackgroundRow(cols));
        }
        inputLines.forEach((line, index) => {
            const row = inputTextStartRow + index;
            const prefix = index === 0
                ? `${INPUT_BG}${PROMPT_FG}${getFooterPromptGlyph()}${RESET_FG} `
                : `${INPUT_BG}  `;
            this.clearScreenRow(row);
            if (isPlaceholder) {
                this.stream.write(this.padLineWithBg(`${prefix}${DIM}${line}`, cols));
            }
            else {
                this.stream.write(this.padLineWithBg(`${prefix}${line}`, cols));
            }
        });
        const effectiveSummaryLine = frame.summaryLine ?? this.lastSummaryLine;
        const summaryStartRow = this.getSummaryStartRow(inputStartRow, effectiveSummaryLine);
        if (summaryStartRow >= 1 && effectiveSummaryLine) {
            this.stream.write(`\x1b[${summaryStartRow};1H`);
            this.stream.write(effectiveSummaryLine);
        }
        if (keepStatusLineVisible) {
            this.stream.write(`\x1b[${statusBarRow};1H${CLEAR_LINE}`);
            this.stream.write(frame.statusLine);
        }
        this.lastInputRenderRows = inputFrameRows;
        this.lastOverlayRenderRows = overlayRows;
        this.lastFooterClearStartRow = clearStartRow;
        this.lastFooterClearEndRow = statusBarRow;
        if (isPermissionOverlay) {
            this.positionCursorForPermissionOverlay(inputFrameRows);
            return;
        }
        this.positionCursorForOverlayInput(inputState, inputRows);
    }
    positionCursorForPermissionOverlay(inputFrameRows) {
        const safeRow = Math.max(1, this.getInputStartRow(inputFrameRows) - 1);
        this.stream.write(`\x1b[${safeRow};1H`);
    }
    positionCursorForOverlayInput(inputState, inputRows) {
        const inputTextStartRow = this.getInputTextStartRow(inputRows);
        if (!this.lastInputValue || !inputState) {
            this.stream.write(`\x1b[${inputTextStartRow};${this.getCursorBase()}H`);
            return;
        }
        const cursorVisibleLine = Math.max(0, Math.min(inputState.cursorVisualLine - inputState.visibleStart, inputState.visibleLines.length - 1));
        const cursorRow = inputTextStartRow + cursorVisibleLine;
        const cursorCol = this.getCursorBase() + inputState.cursorColumn;
        this.stream.write(`\x1b[${cursorRow};${cursorCol}H`);
    }
    /**
     * Position the cursor in the input bar for typing.
     * When showing a placeholder (no user input), cursor goes to column 3 (after "❯ ").
     * When showing user input, cursor goes to the actual cursor position.
     */
    positionCursorForInput() {
        if (!this.lastInputValue) {
            this.stream.write(`\x1b[${this.getInputTextStartRow(1)};${this.getCursorBase()}H`);
            return;
        }
        const state = this.getFooterInputState(this.lastInputValue, this.lastInputCursor);
        const cursorVisibleLine = Math.max(0, Math.min(state.cursorVisualLine - state.visibleStart, state.visibleLines.length - 1));
        const cursorRow = this.getInputTextStartRow(state.visibleLines.length) + cursorVisibleLine;
        const cursorCol = this.getCursorBase() + state.cursorColumn;
        this.stream.write(`\x1b[${cursorRow};${cursorCol}H`);
    }
    /**
     * Clear the last input value.
     * Call this after user submits input so the footer shows placeholder during turn.
     */
    clearLastInput(options) {
        this.lastInputValue = '';
        this.lastInputCursor = 0;
        if (options?.inputPrompt) {
            this.lastInputPrompt = options.inputPrompt;
        }
        if (this.active && options?.renderFooter !== false) {
            this.renderFooter({
                summaryLine: this.lastSummaryLine || undefined,
                statusLine: this.lastStatusLine || undefined,
                inputPrompt: options?.inputPrompt,
            });
        }
    }
    /**
     * Clear the activity line at the bottom of the scroll region.
     * Call this after user input is written, before AI response starts.
     * Does NOT reposition the cursor — content continues from current position.
     */
    clearActivityLine() {
        if (!this.active)
            return;
        this.lastActivityLine = '';
        const activityRow = this.lastActivityRow ?? this.getScrollBottom();
        this.stream.write(`${MOVE_TO_ROW.replace('%d', String(activityRow))}${CLEAR_LINE}`);
        this.stream.write(RESET_ALL);
        this.lastActivityRow = null;
    }
    /**
     * Position cursor for content output, based on how many rows of content
     * were written. Calculates the actual end row (accounting for terminal
     * wrapping) and positions cursor there + gapHeight + 1 to preserve the
     * required blank safety rows before the fixed footer.
     */
    positionAfterContent(contentRows) {
        if (!this.active)
            return;
        const scrollBottom = this.getScrollBottom();
        // Content starts at row 1, ends at row `contentRows`
        // Leave gapHeight blank rows: position at contentEnd + gapHeight + 1.
        const contentEnd = Math.min(contentRows ?? scrollBottom, scrollBottom);
        const targetRow = Math.min(contentEnd + this.config.gapHeight + 1, scrollBottom);
        this.stream.write(`${MOVE_TO_ROW.replace('%d', String(targetRow))}`);
        this.stream.write(RESET_ALL);
    }
    /**
     * Prepare for content output.
     * Clears the activity line at the bottom of the scroll region and positions
     * the cursor there for content to begin.
     * Call this before writing any content to the scroll region.
     */
    beginContentStreaming() {
        if (!this.active)
            return;
        this._contentStreaming = true;
        // Keep the footer rows reserved and visible while content streams so the
        // prompt/status area never visually disappears. Tool phases may temporarily
        // end streaming and show live activity above the footer.
        this._footerVisible = true;
        const scrollBottom = this.getScrollBottom();
        const targetRow = Math.max(1, Math.min(this._cursorRow, scrollBottom));
        this._streamStartRow = targetRow;
        this.stream.write(`${MOVE_TO_ROW.replace('%d', String(targetRow))}`);
        if (this._cursorCol > 0) {
            this.stream.write(`\x1b[${this._cursorCol + 1}G`);
        }
        this.stream.write(RESET_ALL);
    }
    /**
     * Restore footer after content streaming completes.
     */
    endContentStreaming(options) {
        if (!this.active)
            return;
        this._contentStreaming = false;
        this.lastInputValue = '';
        this.lastInputCursor = 0;
        this.renderFooter(options);
        if (shouldCompactSubmittedInputForWindowsTmux()) {
            this.renderFooter(options);
        }
    }
    /**
     * Prepare for content output.
     * Clears the activity line so content can be output without overlap.
     * Call this before writing any content to the scroll region.
     */
    prepareForContent() {
        if (!this.active)
            return;
        // Clear the activity line (scroll region bottom)
        const scrollBottom = this.getScrollBottom();
        this.stream.write(`${MOVE_TO_ROW.replace('%d', String(scrollBottom))}${CLEAR_LINE}`);
    }
    /**
     * Render live activity in the scroll region (not footer).
     * Activity line shows at bottom of scroll region, above the gap row.
     *
     * This method only updates the activity line. Cursor stays at activity line
     * after rendering - do NOT use [s/[u as it resets attributes.
     */
    renderActivity(activityLine) {
        if (!this.active) {
            // Not in scroll region mode, use inline rendering
            this.stream.write(`\r${CLEAR_LINE}${activityLine}`);
            return;
        }
        if (this.hasActiveOverlayPrompt()) {
            return;
        }
        this.lastActivityLine = activityLine;
        // Render activity line at bottom of scroll region
        this.stream.write(this.composeActivityLineRender(activityLine));
        if (!this._footerVisible && !this._contentStreaming && !this.hasActiveOverlayPrompt()) {
            this.renderFooterFrame({
                inputPrompt: this.lastInputPrompt || 'Type your message...',
                summaryLine: this.lastSummaryLine || undefined,
                statusLine: this.lastStatusLine || undefined,
            }, false);
            return;
        }
        if (this._footerVisible) {
            this.renderFooterFrame({
                inputPrompt: this.lastInputPrompt || 'Type your message...',
                summaryLine: this.lastSummaryLine || undefined,
                statusLine: this.lastStatusLine || undefined,
            }, false, true);
            return;
        }
        if (shouldCompactSubmittedInputForWindowsTmux()) {
            this.renderFooter({
                inputPrompt: this.lastInputPrompt || 'Type your message...',
                statusLine: undefined,
            });
        }
    }
    /**
     * Clear activity line from scroll region.
     * Cursor stays at activity line after clearing.
     */
    clearActivity() {
        if (!this.active) {
            this.stream.write(`\r${CLEAR_LINE}`);
            return;
        }
        if (!this.lastActivityLine && this.lastActivityRow === null) {
            return;
        }
        this.lastActivityLine = '';
        const scrollBottom = this.lastActivityRow ?? this.getScrollBottom();
        this.stream.write(`${MOVE_TO_ROW.replace('%d', String(scrollBottom))}${CLEAR_LINE}`);
        this.lastActivityRow = null;
    }
    /**
     * Update status line only (without re-rendering everything).
     */
    updateStatusLine(statusLine) {
        this.lastStatusLine = statusLine;
        if (this.active) {
            if (this.isRendererPermissionOverlayActive() && shouldSkipPermissionOverlayReserve()) {
                return;
            }
            if (this._contentStreaming || !this._footerVisible) {
                return;
            }
            if (this.isRendererPermissionOverlayActive()) {
                const statusBarRow = this.getStatusBarRow();
                this.stream.write(`${MOVE_TO_ROW.replace('%d', String(statusBarRow))}${CLEAR_LINE}`);
                this.stream.write(statusLine);
                this.stream.write(HIDE_CURSOR);
                this.positionCursorForPermissionOverlay(this.lastInputRenderRows);
                return;
            }
            if (this.hasActiveOverlayPrompt()) {
                const statusBarRow = this.getStatusBarRow();
                this.stream.write(`${MOVE_TO_ROW.replace('%d', String(statusBarRow))}${CLEAR_LINE}`);
                this.stream.write(statusLine);
                const inputState = this.lastInputValue
                    ? this.getFooterInputState(this.lastInputValue, this.lastInputCursor)
                    : undefined;
                const inputRows = Math.max(1, inputState?.visibleLines.length ?? 1);
                this.positionCursorForOverlayInput(inputState, inputRows);
                return;
            }
            this.renderFooterFrame({
                inputPrompt: this.lastInputPrompt || 'Type your message...',
                summaryLine: this.lastSummaryLine || undefined,
                statusLine,
            }, false, true);
        }
    }
    /**
     * Set the scroll region ANSI sequence.
     */
    setScrollRegion(scrollEnd = this.getScrollBottom()) {
        this.stream.write(SET_SCROLL_REGION.replace('%d', String(scrollEnd)));
    }
    /**
     * Pad a line to fill the terminal width (clears any remaining characters).
     * If hasBackground is true, the padding will have the background color.
     */
    isContentStreaming() {
        return this._contentStreaming;
    }
    getPromptFrameState() {
        return {
            inputValue: this.lastInputValue,
            cursor: this.lastInputCursor,
            placeholder: this.lastInputPrompt || 'Type your message...',
            summaryLine: this.lastSummaryLine,
            statusLine: this.lastStatusLine,
            overlayLines: this.lastOverlayRenderRows > 0 ? [] : undefined,
        };
    }
    setWelcomeRows(rows) {
        this._welcomeRows = rows;
        this._pastWelcome = true;
        this._totalRows = rows;
        this._cursorRow = this.clampCursorRow(rows + 1);
        this._cursorCol = 0;
    }
    clearContentArea() {
        if (!this.active)
            return;
        const scrollBottom = this.getScrollBottom();
        this.stream.write(RESET_SCROLL_REGION);
        for (let row = 1; row <= scrollBottom; row += 1) {
            this.stream.write(`${MOVE_TO_ROW.replace('%d', String(row))}${CLEAR_LINE}`);
        }
        this.setScrollRegion();
        this._welcomeRows = 0;
        this._totalRows = 0;
        this._contentEndRow = 0;
        this._cursorRow = 1;
        this._cursorCol = 0;
        this._cursorUncertain = false;
        this._pastWelcome = true;
        this._hasStreamedContent = false;
    }
    clearVisibleViewport() {
        if (!this.active)
            return;
        const scrollBottom = this.getScrollBottom();
        this.stream.write(RESET_SCROLL_REGION);
        for (let row = 1; row <= scrollBottom; row += 1) {
            this.stream.write(`${MOVE_TO_ROW.replace('%d', String(row))}${CLEAR_LINE}`);
        }
        this.setScrollRegion();
    }
    advanceContentCursor(rows) {
        if (!this.active)
            return;
        this._totalRows += rows;
        this._cursorRow = this.clampCursorRow(this._cursorRow + rows);
        this._cursorUncertain = false;
    }
    advanceContentCursorByRenderedText(text) {
        if (!this.active || text.length === 0)
            return;
        const cols = this.config.columns;
        const plain = stripAnsi(text);
        let row = this._cursorRow;
        let col = this._cursorCol;
        for (const ch of plain) {
            if (ch === '\n') {
                row = this.clampCursorRow(row + 1);
                col = 0;
                continue;
            }
            const width = Math.max(1, getDisplayWidth(ch));
            if (col + width >= cols) {
                row = this.clampCursorRow(row + 1);
                col = 0;
            }
            col += width;
        }
        this._cursorRow = row;
        this._cursorCol = col;
        this._totalRows = Math.max(this._totalRows, row);
        this._cursorUncertain = false;
    }
    setContentCursor(row) {
        if (!this.active)
            return;
        this._totalRows = row;
        this._cursorRow = this.clampCursorRow(row);
    }
    getContentCursor() {
        return this._totalRows;
    }
    get maxContentRows() {
        return this.getScrollBottom();
    }
    writeAtContentCursor(text) {
        if (!this.active) {
            this.stream.write(text);
            return;
        }
        this.stream.write(RESET_ALL);
        const targetRow = this.clampCursorRow(this._cursorRow);
        this.stream.write(`${MOVE_TO_ROW.replace('%d', String(targetRow))}`);
        const cols = this.config.columns;
        const visibleText = stripAnsi(text);
        let col = this._cursorCol;
        let newlines = 0;
        let extraRows = 0;
        for (const ch of visibleText) {
            if (ch === '\n') {
                newlines++;
                col = 0;
            }
            else if (ch === '\r') {
                col = 0;
            }
            else if (ch === '\t') {
                const next = col + 4 - (col % 4);
                extraRows += Math.floor(next / cols);
                col = next % cols;
            }
            else {
                const w = getDisplayWidth(ch);
                if (col + w >= cols) {
                    extraRows++;
                    col = 0;
                    if (w === cols) {
                        extraRows++;
                        col = 0;
                    }
                    else {
                        col = w;
                    }
                }
                else {
                    col += w;
                }
            }
        }
        const totalRows = newlines + extraRows;
        this._cursorCol = col;
        this._totalRows += totalRows;
        this._cursorRow = this.clampCursorRow(targetRow + totalRows);
        this._contentEndRow = Math.max(this._contentEndRow, this._cursorRow);
        this._pastWelcome = true;
        this._cursorUncertain = false;
        this.stream.write(text);
        if (this._footerVisible && !this._contentStreaming && !this.hasActiveOverlayPrompt()) {
            this.renderFooter({
                inputPrompt: this.lastInputPrompt || 'Type your message...',
                summaryLine: this.lastSummaryLine || undefined,
                statusLine: this.lastStatusLine || undefined,
            });
        }
    }
    writeSubmittedInput(text) {
        if (!this.active) {
            this.stream.write(text);
            return;
        }
        const targetRow = this.clampCursorRow(this._cursorRow);
        this.stream.write(`${MOVE_TO_ROW.replace('%d', String(targetRow))}`);
        if (this._cursorCol > 0) {
            this.stream.write(`\x1b[${this._cursorCol + 1}G`);
        }
        this.stream.write(RESET_ALL);
        const hasPriorTranscript = this._totalRows > this._welcomeRows;
        const separatorRows = hasPriorTranscript
            ? (this._cursorCol > 0 ? 2 : 1)
            : (this._cursorCol > 0 ? 1 : 0);
        for (let index = 0; index < separatorRows; index += 1) {
            this.stream.write('\n');
            this._totalRows++;
            this._cursorRow = this.clampCursorRow(this._cursorRow + 1);
            this._cursorCol = 0;
        }
        // formatSubmittedInput() ends with a spacer row plus a trailing newline.
        // On Windows tmux, counting that final newline as transcript height pushes
        // one extra visible row out of the pane; let the next assistant chunk start
        // on the spacer row instead. Keep the default behavior elsewhere so the
        // existing non-tmux layout semantics stay unchanged.
        const transcriptText = shouldCompactSubmittedInputForWindowsTmux() && text.endsWith('\n')
            ? text.slice(0, -1)
            : text;
        this.writeAtContentCursor(transcriptText);
        this._contentEndRow = this._cursorRow;
        this._cursorCol = 0;
        this._pastWelcome = true;
        // Some real terminals can scroll the fixed footer up by one or more rows
        // when a submitted transcript block lands directly against the footer
        // boundary. Re-anchor the footer immediately so later activity/status
        // updates never inherit a half-cleared prompt/status chrome.
        if (this._footerVisible && !this.hasActiveOverlayPrompt()) {
            this.renderFooter({
                inputPrompt: this.lastInputPrompt || 'Type your message...',
                summaryLine: this.lastSummaryLine || undefined,
                statusLine: this.lastStatusLine || undefined,
            });
        }
    }
    getNewlineCallback() {
        const self = this;
        return function newlineCallback() {
            self.stream.write('\n');
            self._totalRows++;
            self._cursorRow = self.clampCursorRow(self._cursorRow + 1);
            self._cursorCol = 0;
            self._cursorUncertain = false;
        };
    }
    syncContentCursorFromRenderedLines(lines) {
        if (!this.active || lines.length === 0)
            return;
        const cols = this.config.columns;
        let row = this._streamStartRow;
        let col = 0;
        for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
            const text = stripAnsi(lines[lineIndex] ?? '');
            col = 0;
            for (const ch of text) {
                const w = getDisplayWidth(ch);
                if (col + w >= cols) {
                    row = this.clampCursorRow(row + 1);
                    col = 0;
                }
                col += w;
            }
            if (lineIndex < lines.length - 1) {
                row = this.clampCursorRow(row + 1);
                col = 0;
            }
        }
        this._cursorRow = row;
        this._cursorCol = col;
        this._totalRows = Math.max(this._totalRows, row);
        this._cursorUncertain = false;
    }
    padLine(line, width, hasBackground = false) {
        const safeWidth = getSafeRenderWidth(width);
        const visibleLen = getDisplayWidth(line);
        if (visibleLen >= safeWidth)
            return line.slice(0, safeWidth + (line.length - visibleLen));
        const padding = ' '.repeat(safeWidth - visibleLen);
        if (hasBackground) {
            // Background already set, just add spaces, then reset
            return line + padding + RESET_ALL;
        }
        return line + padding;
    }
    /**
     * Pad a line with background color to fill the terminal width.
     * The line should already have background set. Adds spaces and resets.
     */
    padLineWithBg(line, width) {
        const safeWidth = getSafeRenderWidth(width);
        const visibleLen = getDisplayWidth(line);
        if (visibleLen >= safeWidth) {
            // Line is too long, truncate and reset
            return line.slice(0, safeWidth + (line.length - visibleLen)) + RESET_ALL;
        }
        // Add spaces to fill width (background color continues), then reset
        const padding = ' '.repeat(safeWidth - visibleLen);
        return line + padding + RESET_ALL;
    }
    padBackgroundRow(width) {
        return this.padLineWithBg(INPUT_BG, width);
    }
}
