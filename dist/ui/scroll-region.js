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
 * ├──────────────────────────────────┤
 * │ ❯ working...                     │  ← Input bar (fixed footer row 1)
 * │ gpt-5.4 · 0% · master · xiaok-cli│  ← Status bar (fixed footer row 2)
 * └──────────────────────────────────┘
 */
import { getDisplayWidth, splitSymbols, stripAnsi } from './text-metrics.js';
const RESET_SCROLL_REGION = '\x1b[r';
const SET_SCROLL_REGION = '\x1b[1;%dr';
const CLEAR_LINE = '\x1b[2K';
const HIDE_CURSOR = '\x1b[?25l';
const SHOW_CURSOR = '\x1b[?25h';
const MOVE_TO_ROW = '\x1b[%d;1H';
const SAVE_CURSOR = '\x1b[s';
const RESTORE_CURSOR = '\x1b[u';
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
export class ScrollRegionManager {
    stream;
    active = false;
    config;
    lastActivityLine = '';
    lastInputPrompt = '';
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
    lastInputRenderRows = 1;
    /** Last screen rows occupied by footer/overlay chrome, used to clear stale rows after terminal resize. */
    lastFooterClearStartRow = 0;
    lastFooterClearEndRow = 0;
    constructor(stream = process.stdout, config) {
        this.stream = stream;
        const rows = stream.rows ?? 24;
        const columns = stream.columns ?? 80;
        this.config = config ?? {
            footerHeight: 2, // Input bar + status bar
            gapHeight: 2, // Empty gap between transcript/activity/overlay and input bar
            rows,
            columns,
        };
    }
    clampCursorRow(row) {
        return Math.max(1, Math.min(row, this.getScrollBottom()));
    }
    maxInputRows() {
        return Math.max(1, Math.min(MAX_INPUT_ROWS, this.config.rows - this.config.gapHeight - 3));
    }
    /**
     * Calculate the bottom row of the scroll region (where activity line renders).
     */
    getScrollBottom() {
        const reservedRowsAboveInput = this.lastOverlayRenderRows > 0
            ? this.lastOverlayRenderRows + this.config.gapHeight
            : this.config.gapHeight;
        return Math.max(1, this.getInputStartRow() - reservedRowsAboveInput - 1);
    }
    /**
     * Calculate the input bar row where the last input line sits.
     */
    getInputBarRow() {
        return this.getStatusBarRow() - 1;
    }
    getInputStartRow(rows = this.lastInputRenderRows) {
        return Math.max(1, this.getInputBarRow() - rows + 1);
    }
    /**
     * Calculate the status bar row (fixed footer bottom row).
     */
    getStatusBarRow() {
        return this.config.rows;
    }
    getOverlayVisibleLines(lines, inputRows) {
        const maxOverlayRows = Math.max(0, this.config.rows - inputRows - 1 - this.config.gapHeight);
        if (maxOverlayRows <= 0) {
            return [];
        }
        return lines.slice(-maxOverlayRows);
    }
    clearScreenRow(row) {
        this.stream.write(`\x1b[${row};1H${CLEAR_LINE}`);
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
        this.lastInputPrompt = '';
        this.lastInputValue = '';
        this.lastInputCursor = 0;
        this.lastStatusLine = '';
        this.lastInputRenderRows = 1;
        this.lastFooterClearStartRow = 0;
        this.lastFooterClearEndRow = 0;
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
        this.lastInputPrompt = '';
        this.lastInputValue = '';
        this.lastStatusLine = '';
        this.lastFooterClearStartRow = 0;
        this.lastFooterClearEndRow = 0;
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
        this.lastInputValue = frame.inputValue;
        this.lastInputCursor = frame.cursor;
        this.lastInputPrompt = frame.placeholder;
        this.lastStatusLine = frame.statusLine;
        if ((frame.overlayLines?.length ?? 0) > 0) {
            this.renderOverlayPromptFrame(frame);
            return;
        }
        this.renderFooter({
            inputPrompt: frame.placeholder,
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
    updateFooter(inputPrompt, statusLine) {
        if (!this.active)
            return;
        this.lastInputPrompt = inputPrompt;
        if (statusLine !== undefined) {
            this.lastStatusLine = statusLine;
        }
        // Only update status line, not input bar
        const statusBarRow = this.getStatusBarRow();
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
    renderFooter(options) {
        if (!this.active)
            return;
        this._footerVisible = true;
        const cols = this.config.columns;
        // Use inputPrompt as a placeholder text when no user input
        const inputPrompt = options?.inputPrompt ?? this.lastInputPrompt ?? 'waiting...';
        const statusLine = options?.statusLine ?? this.lastStatusLine ?? '';
        // Update cached values
        if (options?.inputPrompt)
            this.lastInputPrompt = options.inputPrompt;
        if (options?.statusLine)
            this.lastStatusLine = options.statusLine;
        const inputState = this.lastInputValue
            ? this.getFooterInputState(this.lastInputValue, this.lastInputCursor)
            : undefined;
        const inputLines = inputState?.visibleLines ?? [inputPrompt];
        const inputRows = Math.max(1, inputLines.length);
        const isPlaceholder = !this.lastInputValue;
        // Use absolute row positioning instead of cursor-down-999 which may be
        // unreliable in some terminals. Calculate exact footer rows.
        const statusBarRow = this.getStatusBarRow();
        const previousInputStartRow = this.getInputStartRow();
        const inputStartRow = this.getInputStartRow(inputRows);
        const inputEndRow = this.getInputBarRow();
        // Reset scroll region to allow writing to footer area
        this.stream.write(RESET_SCROLL_REGION);
        // Clear previous and current editor rows. This prevents stale rows when
        // the input grows or shrinks between redraws.
        const previousOverlayStartRow = this.lastOverlayRenderRows > 0
            ? Math.max(1, previousInputStartRow - this.lastOverlayRenderRows - this.config.gapHeight)
            : previousInputStartRow;
        const footerClearStartRow = Math.max(1, inputStartRow - this.config.gapHeight);
        const clearStartRow = Math.max(1, Math.min(previousOverlayStartRow, footerClearStartRow));
        for (let row = clearStartRow; row <= inputEndRow; row += 1) {
            this.clearScreenRow(row);
        }
        inputLines.forEach((line, index) => {
            const row = inputStartRow + index;
            const prefix = index === 0
                ? `${INPUT_BG}${PROMPT_FG}❯${RESET_FG} `
                : `${INPUT_BG}  `;
            this.stream.write(`\x1b[${row};1H${CLEAR_LINE}`);
            if (isPlaceholder) {
                this.stream.write(this.padLineWithBg(`${prefix}${DIM}${line}`, cols));
            }
            else {
                this.stream.write(this.padLineWithBg(`${prefix}${line}`, cols));
            }
        });
        // Status bar (bottom row) is rendered last so any footer-line wrap quirks
        // in the input editor cannot leave stale status text above it.
        this.stream.write(`\x1b[${statusBarRow};1H${CLEAR_LINE}`);
        if (statusLine) {
            this.stream.write(DIM + statusLine + RESET_ALL);
        }
        this.lastInputRenderRows = inputRows;
        this.lastOverlayRenderRows = 0;
        this.lastFooterClearStartRow = clearStartRow;
        this.lastFooterClearEndRow = statusBarRow;
        // Restore scroll region
        this.setScrollRegion();
        // Position cursor after restoring the scroll region. Some terminals move
        // the cursor when DECSTBM is applied, so this must be the final cursor op.
        this.positionCursorForInput();
    }
    renderOverlayPromptFrame(frame) {
        const cols = this.config.columns;
        const previousInputRows = this.lastInputRenderRows;
        const previousOverlayRows = this.lastOverlayRenderRows;
        const inputState = this.lastInputValue
            ? this.getFooterInputState(this.lastInputValue, this.lastInputCursor)
            : undefined;
        const inputLines = inputState?.visibleLines ?? [frame.placeholder];
        const inputRows = Math.max(1, inputLines.length);
        const overlayLines = this.getOverlayVisibleLines(frame.overlayLines ?? [], inputRows);
        const overlayRows = overlayLines.length;
        const statusBarRow = this.getStatusBarRow();
        const inputStartRow = this.getInputStartRow(inputRows);
        const overlayStartRow = Math.max(1, inputStartRow - this.config.gapHeight - overlayRows);
        const previousOverlayStartRow = Math.max(1, this.getInputStartRow(previousInputRows) - this.config.gapHeight - previousOverlayRows);
        const clearStartRow = Math.min(previousOverlayStartRow, overlayStartRow);
        const scrollBottom = Math.max(1, overlayStartRow - 1);
        const isPlaceholder = !this.lastInputValue;
        this.stream.write(RESET_SCROLL_REGION);
        for (let row = clearStartRow; row <= statusBarRow; row += 1) {
            this.clearScreenRow(row);
        }
        overlayLines.forEach((line, index) => {
            const row = overlayStartRow + index;
            this.clearScreenRow(row);
            this.stream.write(this.padLine(line, cols, false));
        });
        inputLines.forEach((line, index) => {
            const row = inputStartRow + index;
            const prefix = index === 0
                ? `${INPUT_BG}${PROMPT_FG}❯${RESET_FG} `
                : `${INPUT_BG}  `;
            this.clearScreenRow(row);
            if (isPlaceholder) {
                this.stream.write(this.padLineWithBg(`${prefix}${DIM}${line}`, cols));
            }
            else {
                this.stream.write(this.padLineWithBg(`${prefix}${line}`, cols));
            }
        });
        this.lastInputRenderRows = inputRows;
        this.lastOverlayRenderRows = overlayRows;
        this.lastFooterClearStartRow = clearStartRow;
        this.lastFooterClearEndRow = statusBarRow;
        this.setScrollRegion(scrollBottom);
        this.positionCursorForOverlayInput(inputState, inputLines.length);
    }
    positionCursorForOverlayInput(inputState, inputRows) {
        const inputStartRow = this.getInputStartRow(inputRows);
        if (!this.lastInputValue || !inputState) {
            this.stream.write(`\x1b[${inputStartRow};${this.getCursorBase()}H`);
            return;
        }
        const cursorVisibleLine = Math.max(0, Math.min(inputState.cursorVisualLine - inputState.visibleStart, inputState.visibleLines.length - 1));
        const cursorRow = inputStartRow + cursorVisibleLine;
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
            this.stream.write(`\x1b[${this.getInputStartRow()};${this.getCursorBase()}H`);
            return;
        }
        const state = this.getFooterInputState(this.lastInputValue, this.lastInputCursor);
        const cursorVisibleLine = Math.max(0, Math.min(state.cursorVisualLine - state.visibleStart, state.visibleLines.length - 1));
        const cursorRow = this.getInputStartRow(state.visibleLines.length) + cursorVisibleLine;
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
        if (this.active && options?.renderFooter !== false) {
            this.renderFooter({
                statusLine: this.lastStatusLine || undefined,
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
        const scrollBottom = this.getScrollBottom();
        this.stream.write(`${MOVE_TO_ROW.replace('%d', String(scrollBottom))}${CLEAR_LINE}`);
        this.stream.write(RESET_ALL);
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
        this._footerVisible = false;
        const scrollBottom = this.getScrollBottom();
        this.stream.write(`${MOVE_TO_ROW.replace('%d', String(scrollBottom))}${CLEAR_LINE}`);
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
        this.lastActivityLine = activityLine;
        // Render activity line at bottom of scroll region
        const scrollBottom = this.getScrollBottom();
        const cols = this.config.columns;
        this.stream.write(`${MOVE_TO_ROW.replace('%d', String(scrollBottom))}${CLEAR_LINE}${this.padLine(activityLine, cols, false)}`);
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
        this.lastActivityLine = '';
        const scrollBottom = this.getScrollBottom();
        this.stream.write(`${MOVE_TO_ROW.replace('%d', String(scrollBottom))}${CLEAR_LINE}`);
    }
    /**
     * Update status line only (without re-rendering everything).
     */
    updateStatusLine(statusLine) {
        this.lastStatusLine = statusLine;
        if (this.active) {
            const statusBarRow = this.getStatusBarRow();
            this.stream.write(SAVE_CURSOR);
            this.stream.write(`${MOVE_TO_ROW.replace('%d', String(statusBarRow))}${CLEAR_LINE}`);
            this.stream.write(DIM + statusLine + RESET_ALL);
            this.stream.write(RESTORE_CURSOR);
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
        this._cursorUncertain = false;
        this.stream.write(text);
    }
    writeSubmittedInput(text) {
        if (!this.active) {
            this.stream.write(text);
            return;
        }
        const hasPriorTranscript = this._totalRows > this._welcomeRows;
        if (this._cursorCol > 0 || hasPriorTranscript) {
            this.stream.write('\n');
            this._totalRows++;
            this._cursorRow = this.clampCursorRow(this._cursorRow + 1);
            this._cursorCol = 0;
        }
        this.writeAtContentCursor(text);
        this._contentEndRow = this._cursorRow;
        this._cursorCol = 0;
        this._pastWelcome = true;
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
        const safeWidth = Math.max(1, width - 1);
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
        const safeWidth = Math.max(1, width - 1);
        const visibleLen = getDisplayWidth(line);
        if (visibleLen >= safeWidth) {
            // Line is too long, truncate and reset
            return line.slice(0, safeWidth + (line.length - visibleLen)) + RESET_ALL;
        }
        // Add spaces to fill width (background color continues), then reset
        const padding = ' '.repeat(safeWidth - visibleLen);
        return line + padding + RESET_ALL;
    }
}
