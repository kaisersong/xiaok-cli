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

import { getDisplayWidth, stripAnsi } from './text-metrics.js';

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
const INPUT_BG = '\x1b[48;5;244m';   // Gray background
const PROMPT_FG = '\x1b[1;36m';      // Bold cyan for ❯
const RESET_FG = '\x1b[22;39m';      // Reset bold + fg, keep bg
const RESET_ALL = '\x1b[0m';
const DIM = '\x1b[2m';
const MAX_INPUT_ROWS = 6;

interface FooterInputState {
  lines: string[];
  visibleStart: number;
  visibleLines: string[];
  cursorLine: number;
  cursorColumn: number;
}

export class ScrollRegionManager {
  private active = false;
  private config: ScrollRegionConfig;
  private lastActivityLine = '';
  private lastInputPrompt = '';
  private lastStatusLine = '';
  private lastInputValue = '';
  private lastInputCursor = 0;
  /** Number of terminal rows the welcome screen occupies. */
  private _welcomeRows = 0;
  /** Total content rows written since begin() (including welcome). */
  private _totalRows = 0;
  /** Whether content is currently being streamed. */
  private _contentStreaming = false;
  /** Whether any markdown content has been streamed yet. */
  private _hasStreamedContent = false;
  /** Footer is currently visible on screen. */
  private _footerVisible = false;
  /** Tracks if we have already pushed past the welcome screen. */
  private _pastWelcome = false;
  /** Last row containing content (before footer). Updated at end of streaming. */
  private _contentEndRow = 0;
  /** Actual terminal cursor row (1-based), tracked by counting \n writes. */
  private _cursorRow = 1;
  /** Actual terminal cursor column (0-based), for wrapping calculation. */
  private _cursorCol = 0;
  /** Internal flag: cursor position may be unreliable (just after screen clear). */
  private _cursorUncertain = false;
  /** Content row where the current markdown streaming block began. */
  private _streamStartRow = 1;
  /** Number of rows currently occupied by the input editor above status. */
  private lastInputRenderRows = 1;


  constructor(
    private readonly stream: NodeJS.WriteStream = process.stdout,
    config?: ScrollRegionConfig,
  ) {
    const rows = stream.rows ?? 24;
    const columns = stream.columns ?? 80;
    this.config = config ?? {
      footerHeight: 2, // Input bar + status bar
      gapHeight: 1,    // Empty gap between activity and input bar
      rows,
      columns,
    };
  }

  private clampCursorRow(row: number): number {
    return Math.max(1, Math.min(row, this.getScrollBottom()));
  }

  private maxInputRows(): number {
    return Math.max(1, Math.min(MAX_INPUT_ROWS, this.config.rows - this.config.gapHeight - 3));
  }

  /**
   * Calculate the bottom row of the scroll region (where activity line renders).
   */
  private getScrollBottom(): number {
    return Math.max(1, this.getInputStartRow() - this.config.gapHeight - 1);
  }

  /**
   * Calculate the input bar row where the last input line sits.
   */
  private getInputBarRow(): number {
    return this.getStatusBarRow() - 1;
  }

  private getInputStartRow(rows = this.lastInputRenderRows): number {
    return Math.max(1, this.getInputBarRow() - rows + 1);
  }

  /**
   * Calculate the status bar row (fixed footer bottom row).
   */
  private getStatusBarRow(): number {
    return this.config.rows;
  }

  /**
   * Calculate cursor column after the "❯ " prefix.
   * "❯" is at column 1, space at column 2, text starts at column 3.
   */
  private getCursorBase(): number {
    return 3;
  }

  private getFooterInputState(inputValue: string, cursor: number): FooterInputState {
    const lines = inputValue.split('\n');
    let remaining = Math.max(0, Math.min(cursor, inputValue.length));
    let cursorLine = 0;
    let cursorColumn = 0;

    for (let index = 0; index < lines.length; index += 1) {
      const lineLength = lines[index]?.length ?? 0;
      if (remaining <= lineLength) {
        cursorLine = index;
        cursorColumn = remaining;
        break;
      }
      remaining -= lineLength + 1;
      cursorLine = Math.min(index + 1, lines.length - 1);
      cursorColumn = 0;
    }

    const maxRows = this.maxInputRows();
    const maxStart = Math.max(0, lines.length - maxRows);
    const visibleStart = Math.min(Math.max(0, cursorLine - maxRows + 1), maxStart);
    const visibleLines = lines.slice(visibleStart, visibleStart + maxRows);

    return {
      lines,
      visibleStart,
      visibleLines,
      cursorLine,
      cursorColumn,
    };
  }

  /**
   * Update terminal size.
   */
  updateSize(rows: number, columns: number): void {
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
  begin(): void {
    if (this.active) return;

    this.active = true;
    this.lastActivityLine = '';
    this.lastInputPrompt = '';
    this.lastInputValue = '';
    this.lastInputCursor = 0;
    this.lastStatusLine = '';
    this.lastInputRenderRows = 1;

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
  end(): void {
    if (!this.active) return;

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
  }

  /**
   * Check if scroll region is active.
   */
  isActive(): boolean {
    return this.active;
  }

  renderPromptFrame(frame: ScrollPromptFrame): void {
    if (!this.active) return;

    this.lastInputValue = frame.inputValue;
    this.lastInputCursor = frame.cursor;
    this.lastInputPrompt = frame.placeholder;
    this.lastStatusLine = frame.statusLine;

    this.renderFooter({
      inputPrompt: frame.placeholder,
      statusLine: frame.statusLine,
    });
    this.renderOverlay(frame.overlayLines ?? []);
  }

  /**
   * Render input in the fixed footer area.
   * This should be called when user types during streaming.
   * @param inputValue - The current input value (may contain newlines)
   * @param cursor - Cursor position in the input value
   */
  renderInput(inputValue: string, cursor: number): void {
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
  updateFooter(inputPrompt: string, statusLine?: string): void {
    if (!this.active) return;

    this.lastInputPrompt = inputPrompt;
    if (statusLine !== undefined) {
      this.lastStatusLine = statusLine;
    }

    // Only update status line, not input bar
    const statusBarRow = this.getStatusBarRow();
    const cols = this.config.columns;

    this.stream.write(`${MOVE_TO_ROW.replace('%d', String(statusBarRow))}${CLEAR_LINE}`);
    if (statusLine) {
      this.stream.write(this.padLine(DIM + statusLine + RESET_ALL, cols, false));
    }

    // Position cursor at input line for typing
    this.positionCursorForInput();
  }

  /**
   * Render the footer area (input prompt + status bar).
   * Status bar shows static info like model, percentage, branch, project.
   * After rendering, cursor is positioned at input line for user typing.
   */
  renderFooter(options?: {
    inputPrompt?: string;
    statusLine?: string;
  }): void {
    if (!this.active) return;

    this._footerVisible = true;

    const cols = this.config.columns;

    // Use inputPrompt as a placeholder text when no user input
    const inputPrompt = options?.inputPrompt ?? this.lastInputPrompt ?? 'waiting...';
    const statusLine = options?.statusLine ?? this.lastStatusLine ?? '';

    // Update cached values
    if (options?.inputPrompt) this.lastInputPrompt = options.inputPrompt;
    if (options?.statusLine) this.lastStatusLine = options.statusLine;

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
    const clearStartRow = Math.min(previousInputStartRow, inputStartRow);
    for (let row = clearStartRow; row <= inputEndRow; row += 1) {
      this.stream.write(`\x1b[${row};1H${CLEAR_LINE}`);
    }

    // Status bar (bottom row)
    this.stream.write(`\x1b[${statusBarRow};1H${CLEAR_LINE}`);
    if (statusLine) {
      this.stream.write(DIM + statusLine + RESET_ALL);
    }

    inputLines.forEach((line, index) => {
      const row = inputStartRow + index;
      const prefix = index === 0
        ? `${INPUT_BG}${PROMPT_FG}❯${RESET_FG} `
        : `${INPUT_BG}  `;
      const textPrefix = isPlaceholder ? DIM : '';
      this.stream.write(`\x1b[${row};1H${CLEAR_LINE}`);
      this.stream.write(this.padLineWithBg(`${prefix}${textPrefix}${line}`, cols));
    });

    this.lastInputRenderRows = inputRows;

    // Restore scroll region
    this.setScrollRegion();

    // Position cursor after restoring the scroll region. Some terminals move
    // the cursor when DECSTBM is applied, so this must be the final cursor op.
    this.positionCursorForInput();
  }

  private renderOverlay(lines: string[]): void {
    if (!this.active || lines.length === 0) return;

    const inputBarRow = this.getInputStartRow();
    const scrollBottom = this.getScrollBottom();
    const maxOverlayLines = Math.max(0, inputBarRow - scrollBottom - 1);
    const visibleLines = lines.slice(-maxOverlayLines);
    const overlayStart = Math.max(scrollBottom + 1, inputBarRow - visibleLines.length);

    visibleLines.forEach((line, index) => {
      const row = overlayStart + index;
      if (row >= inputBarRow) return;
      this.stream.write(`${MOVE_TO_ROW.replace('%d', String(row))}${CLEAR_LINE}${line}`);
    });

    this.positionCursorForInput();
  }

  /**
   * Position the cursor in the input bar for typing.
   * When showing a placeholder (no user input), cursor goes to column 3 (after "❯ ").
   * When showing user input, cursor goes to the actual cursor position.
   */
  private positionCursorForInput(): void {
    if (!this.lastInputValue) {
      this.stream.write(`\x1b[${this.getInputStartRow()};${this.getCursorBase()}H`);
      return;
    }

    const state = this.getFooterInputState(this.lastInputValue, this.lastInputCursor);
    const cursorVisibleLine = Math.max(
      0,
      Math.min(state.cursorLine - state.visibleStart, state.visibleLines.length - 1),
    );
    const cursorRow = this.getInputStartRow(state.visibleLines.length) + cursorVisibleLine;
    const cursorLineText = state.lines[state.cursorLine] ?? '';
    const cursorCol = this.getCursorBase()
      + getDisplayWidth(cursorLineText.slice(0, state.cursorColumn));

    this.stream.write(`\x1b[${cursorRow};${cursorCol}H`);
  }

  /**
   * Clear the last input value.
   * Call this after user submits input so the footer shows placeholder during turn.
   */
  clearLastInput(): void {
    this.lastInputValue = '';
    this.lastInputCursor = 0;
    if (this.active) {
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
  clearActivityLine(): void {
    if (!this.active) return;

    const scrollBottom = this.getScrollBottom();
    this.stream.write(`${MOVE_TO_ROW.replace('%d', String(scrollBottom))}${CLEAR_LINE}`);
    this.stream.write(RESET_ALL);
  }

  /**
   * Position cursor for content output, based on how many rows of content
   * were written. Calculates the actual end row (accounting for terminal
   * wrapping) and positions cursor there + 1 for a gap row.
   */
  positionAfterContent(contentRows?: number): void {
    if (!this.active) return;

    const scrollBottom = this.getScrollBottom();
    // Content starts at row 1, ends at row `contentRows`
    // Leave a gap row: position at contentEnd + 2, but not past scrollBottom
    const contentEnd = Math.min(contentRows ?? scrollBottom, scrollBottom);
    const targetRow = Math.min(contentEnd + 2, scrollBottom);

    this.stream.write(`${MOVE_TO_ROW.replace('%d', String(targetRow))}`);
    this.stream.write(RESET_ALL);
  }

  /**
   * Prepare for content output.
   * Clears the activity line at the bottom of the scroll region and positions
   * the cursor there for content to begin.
   * Call this before writing any content to the scroll region.
   */
  beginContentStreaming(): void {
    if (!this.active) return;

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
  endContentStreaming(options?: {
    inputPrompt?: string;
    statusLine?: string;
  }): void {
    if (!this.active) return;

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
  prepareForContent(): void {
    if (!this.active) return;

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
  renderActivity(activityLine: string): void {
    if (!this.active) {
      // Not in scroll region mode, use inline rendering
      this.stream.write(`\r${CLEAR_LINE}${activityLine}`);
      return;
    }

    this.lastActivityLine = activityLine;

    // Render activity line at bottom of scroll region
    const scrollBottom = this.getScrollBottom();
    const cols = this.config.columns;

    // Move to activity line, clear, and write - cursor stays here
    this.stream.write(`${MOVE_TO_ROW.replace('%d', String(scrollBottom))}${CLEAR_LINE}`);
    this.stream.write(this.padLine(activityLine, cols, false));
    if (this._footerVisible && !this._contentStreaming) {
      this.positionCursorForInput();
    }
  }

  /**
   * Clear activity line from scroll region.
   * Cursor stays at activity line after clearing.
   */
  clearActivity(): void {
    if (!this.active) {
      this.stream.write(`\r${CLEAR_LINE}`);
      return;
    }

    this.lastActivityLine = '';
    const scrollBottom = this.getScrollBottom();

    // Clear activity line in scroll region - cursor stays here
    this.stream.write(`${MOVE_TO_ROW.replace('%d', String(scrollBottom))}${CLEAR_LINE}`);
  }

  /**
   * Update status line only (without re-rendering everything).
   */
  updateStatusLine(statusLine: string): void {
    this.lastStatusLine = statusLine;
    if (this.active) {
      const statusBarRow = this.getStatusBarRow();
      this.stream.write(SAVE_CURSOR);
      this.stream.write(`${MOVE_TO_ROW.replace('%d', String(statusBarRow))}${CLEAR_LINE}`);
      this.stream.write(this.padLine(DIM + statusLine + RESET_ALL, this.config.columns, false));
      this.stream.write(RESTORE_CURSOR);
    }
  }

  /**
   * Set the scroll region ANSI sequence.
   */
  private setScrollRegion(): void {
    const scrollEnd = this.getScrollBottom();
    this.stream.write(SET_SCROLL_REGION.replace('%d', String(scrollEnd)));
  }

  /**
   * Pad a line to fill the terminal width (clears any remaining characters).
   * If hasBackground is true, the padding will have the background color.
   */

  isContentStreaming(): boolean {
    return this._contentStreaming;
  }

  setWelcomeRows(rows: number): void {
    this._welcomeRows = rows;
    this._pastWelcome = true;
    this._totalRows = rows;
    this._cursorRow = this.clampCursorRow(rows + 1);
    this._cursorCol = 0;
  }

  clearContentArea(): void {
    if (!this.active) return;

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

  advanceContentCursor(rows: number): void {
    if (!this.active) return;
    this._totalRows += rows;
    this._cursorRow = this.clampCursorRow(this._cursorRow + rows);
    this._cursorUncertain = false;
  }

  setContentCursor(row: number): void {
    if (!this.active) return;
    this._totalRows = row;
    this._cursorRow = this.clampCursorRow(row);
  }

  getContentCursor(): number {
    return this._totalRows;
  }

  get maxContentRows(): number {
    return this.getScrollBottom();
  }

  writeAtContentCursor(text: string): void {
    if (!this.active) {
      this.stream.write(text);
      return;
    }
    this.stream.write(RESET_ALL);
    const targetRow = this.clampCursorRow(this._cursorRow);
    this.stream.write(`${MOVE_TO_ROW.replace('%d', String(targetRow))}`);

    const cols = this.config.columns;
    let col = this._cursorCol;
    let newlines = 0;
    let extraRows = 0;

    for (const ch of text) {
      if (ch === '\n') {
        newlines++;
        col = 0;
      } else if (ch === '\r') {
        col = 0;
      } else if (ch === '\t') {
        const next = col + 4 - (col % 4);
        extraRows += Math.floor(next / cols);
        col = next % cols;
      } else {
        const w = getDisplayWidth(ch);
        if (col + w >= cols) {
          extraRows++;
          col = 0;
          if (w === cols) {
            extraRows++;
            col = 0;
          } else {
            col = w;
          }
        } else {
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

  writeSubmittedInput(text: string): void {
    if (!this.active) {
      this.stream.write(text);
      return;
    }
    if (this._cursorCol > 0) {
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

  getNewlineCallback(): (() => void) {
    const self = this;
    return function newlineCallback() {
      self.stream.write('\n');
      self._totalRows++;
      self._cursorRow = self.clampCursorRow(self._cursorRow + 1);
      self._cursorCol = 0;
      self._cursorUncertain = false;
    };
  }

  syncContentCursorFromRenderedLines(lines: string[]): void {
    if (!this.active || lines.length === 0) return;

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
  private padLine(line: string, width: number, hasBackground = false): string {
    const visibleLen = getDisplayWidth(line);
    if (visibleLen >= width) return line.slice(0, width + (line.length - visibleLen));
    const padding = ' '.repeat(width - visibleLen);
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
  private padLineWithBg(line: string, width: number): string {
    const visibleLen = getDisplayWidth(line);
    if (visibleLen >= width) {
      // Line is too long, truncate and reset
      return line.slice(0, width + (line.length - visibleLen)) + RESET_ALL;
    }
    // Add spaces to fill width (background color continues), then reset
    const padding = ' '.repeat(width - visibleLen);
    return line + padding + RESET_ALL;
  }

}
