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

import { getDisplayWidth } from './text-metrics.js';

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

const RESET_SCROLL_REGION = '\x1b[r';
const SET_SCROLL_REGION = '\x1b[1;%dr';
const CLEAR_LINE = '\x1b[2K';
const HIDE_CURSOR = '\x1b[?25l';
const SHOW_CURSOR = '\x1b[?25h';
const MOVE_TO_ROW = '\x1b[%d;1H';

// Input bar styling
const INPUT_BG = '\x1b[48;5;244m';   // Gray background
const PROMPT_FG = '\x1b[1;36m';      // Bold cyan for ❯
const RESET_FG = '\x1b[22;39m';      // Reset bold + fg, keep bg
const RESET_ALL = '\x1b[0m';
const DIM = '\x1b[2m';

export class ScrollRegionManager {
  private active = false;
  private config: ScrollRegionConfig;
  private lastActivityLine = '';
  private lastInputPrompt = '';
  private lastStatusLine = '';
  private lastInputValue = '';
  private lastInputCursor = 0;

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

  /**
   * Calculate the bottom row of the scroll region (where activity line renders).
   */
  private getScrollBottom(): number {
    return this.config.rows - this.config.footerHeight - this.config.gapHeight;
  }

  /**
   * Calculate the input bar row (fixed footer first row).
   */
  private getInputBarRow(): number {
    return this.config.rows - this.config.footerHeight + 1;
  }

  /**
   * Calculate the status bar row (fixed footer second row).
   */
  private getStatusBarRow(): number {
    return this.config.rows - this.config.footerHeight + 2;
  }

  /**
   * Calculate cursor column after the "❯ " prefix.
   * "❯" is at column 1, space at column 2, text starts at column 3.
   */
  private getCursorBase(): number {
    return 3;
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

    // Clear footer area (input bar and status bar)
    const inputBarRow = this.getInputBarRow();
    const statusBarRow = this.getStatusBarRow();
    for (const row of [inputBarRow, statusBarRow]) {
      this.stream.write(`${MOVE_TO_ROW.replace('%d', String(row))}${CLEAR_LINE}`);
    }

    // Move cursor to after the last content line (bottom of scroll region)
    this.stream.write(`${MOVE_TO_ROW.replace('%d', String(this.getScrollBottom()))}`);
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
      this.stream.write(`\x1b[1;${cursorCol}H${INPUT_BG}`);
      return;
    }

    this.lastInputValue = inputValue;
    this.lastInputCursor = cursor;

    // Render input bar with user's input
    const inputBarRow = this.getInputBarRow();
    const cols = this.config.columns;

    // Handle multi-line input: show only the last line in input bar
    const lines = inputValue.split('\n');
    const displayLine = lines[lines.length - 1] ?? '';
    const lineCount = lines.length;

    // Build input line with line indicator if multi-line
    let inputText = displayLine;
    if (lineCount > 1) {
      inputText = `[${lineCount} lines] ${displayLine}`;
    }

    // Move to input line, clear it, and write content
    this.stream.write(`${MOVE_TO_ROW.replace('%d', String(inputBarRow))}\r${CLEAR_LINE}`);

    // Write input line with background
    const inputLine = `${INPUT_BG}${PROMPT_FG}❯${RESET_FG} ${inputText}`;
    this.stream.write(inputLine);

    // Pad to end of line with background, then reset
    const textWidth = this.getCursorBase() - 1 + getDisplayWidth(inputText); // "❯ " + text
    const padWidth = cols - textWidth;
    if (padWidth > 0) {
      this.stream.write(`${INPUT_BG}${' '.repeat(padWidth)}${RESET_ALL}`);
    }

    // Position cursor using absolute row;col positioning (atomic, IME-safe)
    const cursorCol = this.calcCursorCol(inputText, cursor, lineCount, lines);

    // Single atomic write: position cursor + set background for subsequent typing
    this.stream.write(`\x1b[${inputBarRow};${cursorCol}H${INPUT_BG}`);
  }

  /**
   * Calculate the cursor column for the input bar.
   */
  private calcCursorCol(
    inputText: string,
    cursor: number,
    lineCount: number,
    lines: string[],
  ): number {
    let cursorCol = this.getCursorBase(); // After "❯ "
    if (lineCount > 1) {
      const prefix = `[${lineCount} lines] `;
      cursorCol += getDisplayWidth(prefix);
    }
    let charsBeforeLastLine = 0;
    for (let i = 0; i < lines.length - 1; i++) {
      charsBeforeLastLine += (lines[i]?.length ?? 0) + 1;
    }
    const cursorInLastLine = Math.max(0, cursor - charsBeforeLastLine);
    // For multi-line, inputText has a prefix, so adjust slice offset
    const prefixLen = lineCount > 1 ? `[${lineCount} lines] `.length : 0;
    cursorCol += getDisplayWidth(inputText.slice(prefixLen, prefixLen + cursorInLastLine));
    return cursorCol;
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

    const inputBarRow = this.getInputBarRow();
    const statusBarRow = this.getStatusBarRow();
    const cols = this.config.columns;

    // Use inputPrompt as a placeholder text when no user input
    const inputPrompt = options?.inputPrompt ?? this.lastInputPrompt ?? 'waiting...';
    const statusLine = options?.statusLine ?? this.lastStatusLine ?? '';

    // Update cached values
    if (options?.inputPrompt) this.lastInputPrompt = options.inputPrompt;
    if (options?.statusLine) this.lastStatusLine = options.statusLine;

    // Row 1: 输入栏 (Input prompt with background)
    const displayText = this.lastInputValue || inputPrompt;
    const isPlaceholder = !this.lastInputValue;

    // Use absolute positioning (row;colH uses global coordinates by default)
    this.stream.write(`${MOVE_TO_ROW.replace('%d', String(inputBarRow))}${CLEAR_LINE}`);
    const textPrefix = isPlaceholder ? DIM : '';
    const inputLine = `${INPUT_BG}${PROMPT_FG}❯${RESET_FG} ${textPrefix}${displayText}`;
    this.stream.write(this.padLineWithBg(inputLine, cols));

    // Row 2: 状态栏
    this.stream.write(`${MOVE_TO_ROW.replace('%d', String(statusBarRow))}${CLEAR_LINE}`);
    if (statusLine) {
      this.stream.write(this.padLine(DIM + statusLine + RESET_ALL, cols, false));
    }

    // Position cursor: if there's user input, use the cursor position; otherwise at start
    this.positionCursorForInput(displayText, isPlaceholder);
  }

  /**
   * Position the cursor in the input bar for typing.
   * When showing a placeholder (no user input), cursor goes to column 3 (after "❯ ").
   * When showing user input, cursor goes to the actual cursor position.
   */
  private positionCursorForInput(
    fallbackDisplayText?: string,
    isPlaceholder?: boolean,
  ): void {
    const inputBarRow = this.getInputBarRow();

    if (this.lastInputValue) {
      // User has typed - position cursor at the actual location
      const displayWidth = getDisplayWidth(this.lastInputValue.slice(0, this.lastInputCursor));
      const cursorCol = this.getCursorBase() + displayWidth;
      this.stream.write(`\x1b[${inputBarRow};${cursorCol}H${INPUT_BG}`);
    } else {
      // Placeholder mode - cursor at the start of the input area (after "❯ ")
      const cursorCol = this.getCursorBase();
      this.stream.write(`\x1b[${inputBarRow};${cursorCol}H${INPUT_BG}`);
    }
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
        inputPrompt: 'working...',
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
  positionAfterContent(contentRows: number): void {
    if (!this.active) return;

    const scrollBottom = this.getScrollBottom();
    // Content starts at row 1, ends at row `contentRows`
    // Leave a gap row: position at contentEnd + 2, but not past scrollBottom
    const contentEnd = Math.min(contentRows, scrollBottom);
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

    const scrollBottom = this.getScrollBottom();
    this.stream.write(`${MOVE_TO_ROW.replace('%d', String(scrollBottom))}${CLEAR_LINE}`);
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
    // Cursor now at activity line - input bar is NOT affected
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
      this.stream.write(`${MOVE_TO_ROW.replace('%d', String(statusBarRow))}${CLEAR_LINE}`);
      this.stream.write(this.padLine(DIM + statusLine + RESET_ALL, this.config.columns, false));
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
