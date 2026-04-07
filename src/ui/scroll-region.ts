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
      rows,
      columns,
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
   * Sets up the scroll region. Footer is rendered separately by beginActivity().
   */
  begin(): void {
    if (this.active) return;

    this.active = true;
    this.lastActivityLine = '';
    this.lastInputPrompt = '';
    this.lastInputValue = '';
    this.lastInputCursor = 0;
    this.lastStatusLine = '';

    // Set scroll region (rows 1 to rows-footerHeight)
    this.setScrollRegion();

    // Position cursor at top of scroll region for content output
    this.stream.write(`\x1b[H`);

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
    const footerStart = this.config.rows - this.config.footerHeight + 1;
    for (let i = 0; i < this.config.footerHeight; i++) {
      this.stream.write(`${MOVE_TO_ROW.replace('%d', String(footerStart + i))}${CLEAR_LINE}`);
    }

    // Move cursor to after the last content line (bottom of scroll region)
    this.stream.write(`${MOVE_TO_ROW.replace('%d', String(this.config.rows - this.config.footerHeight))}`);
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
      this.stream.write(`\r${CLEAR_LINE}${INPUT_BG}${PROMPT_FG}❯${RESET_FG} ${inputValue}${RESET_ALL}`);
      return;
    }

    this.lastInputValue = inputValue;
    this.lastInputCursor = cursor;

    // Render input bar with user's input
    const footerStart = this.config.rows - this.config.footerHeight + 1;
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

    // Move to input line
    this.stream.write(`${MOVE_TO_ROW.replace('%d', String(footerStart))}\r`);

    // Clear line first (this also resets attributes)
    this.stream.write(CLEAR_LINE);

    // Write input line with background
    const inputLine = `${INPUT_BG}${PROMPT_FG}❯${RESET_FG} ${inputText}`;
    this.stream.write(inputLine);

    // Pad to end of line with background, then reset
    const textWidth = 2 + inputText.length; // "❯ " + text
    const padWidth = cols - textWidth;
    if (padWidth > 0) {
      this.stream.write(`${INPUT_BG}${' '.repeat(padWidth)}${RESET_ALL}`);
    }

    // Position cursor for typing
    let cursorCol = 2; // After "❯ "
    if (lineCount > 1) {
      cursorCol += `[${lineCount} lines] `.length;
    }
    let charsBeforeLastLine = 0;
    for (let i = 0; i < lines.length - 1; i++) {
      charsBeforeLastLine += (lines[i]?.length ?? 0) + 1;
    }
    const cursorInLastLine = Math.max(0, cursor - charsBeforeLastLine);
    cursorCol += cursorInLastLine;

    this.stream.write(`${MOVE_TO_ROW.replace('%d', String(footerStart))}\r`);
    if (cursorCol > 0) {
      this.stream.write(`\x1b[${cursorCol}C`);
    }
    // Set background color attribute at cursor position for subsequent typing
    this.stream.write(INPUT_BG);
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

    // Only update status line (row 2), not input bar (row 1)
    const footerStart = this.config.rows - this.config.footerHeight + 1;
    const cols = this.config.columns;

    this.stream.write(`${MOVE_TO_ROW.replace('%d', String(footerStart + 1))}${CLEAR_LINE}`);
    if (statusLine) {
      this.stream.write(this.padLine(DIM + statusLine + RESET_ALL, cols, false));
    }

    // Position cursor at input line for typing
    this.stream.write(`${MOVE_TO_ROW.replace('%d', String(footerStart))}`);
    const cursorOffset = 2 + (this.lastInputCursor || this.lastInputValue.length);
    if (cursorOffset > 2) {
      this.stream.write(`\x1b[${cursorOffset}C`);
    }
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

    const footerStart = this.config.rows - this.config.footerHeight + 1;
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
    this.stream.write(`${MOVE_TO_ROW.replace('%d', String(footerStart))}${CLEAR_LINE}`);
    const textPrefix = isPlaceholder ? DIM : '';
    const inputLine = `${INPUT_BG}${PROMPT_FG}❯${RESET_FG} ${textPrefix}${displayText}`;
    this.stream.write(this.padLineWithBg(inputLine, cols));

    // Row 2: 状态栏
    this.stream.write(`${MOVE_TO_ROW.replace('%d', String(footerStart + 1))}${CLEAR_LINE}`);
    if (statusLine) {
      this.stream.write(this.padLine(DIM + statusLine + RESET_ALL, cols, false));
    }

    // Position cursor at input line for typing
    this.stream.write(`${MOVE_TO_ROW.replace('%d', String(footerStart))}`);
    const cursorOffset = 2 + (this.lastInputCursor || displayText.length);
    if (cursorOffset > 2) {
      this.stream.write(`\x1b[${cursorOffset}C`);
    }
    // Cursor stays at activity line - input bar rendering is independent
    // and will be handled by renderInput() when user types
  }

  /**
   * Prepare for content output.
   * Clears the activity line so content can be output without overlap.
   * Call this before writing any content to the scroll region.
   */
  prepareForContent(): void {
    if (!this.active) return;

    // Clear the activity line (scroll region bottom)
    const scrollBottom = this.config.rows - this.config.footerHeight;
    this.stream.write(`${MOVE_TO_ROW.replace('%d', String(scrollBottom))}${CLEAR_LINE}`);
  }

  /**
   * Render live activity in the scroll region (not footer).
   * Activity line shows at bottom of scroll region, above the input bar.
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
    const scrollBottom = this.config.rows - this.config.footerHeight;
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
    const scrollBottom = this.config.rows - this.config.footerHeight;

    // Clear activity line in scroll region - cursor stays here
    this.stream.write(`${MOVE_TO_ROW.replace('%d', String(scrollBottom))}${CLEAR_LINE}`);
  }

  /**
   * Update status line only (without re-rendering everything).
   */
  updateStatusLine(statusLine: string): void {
    this.lastStatusLine = statusLine;
    if (this.active) {
      const footerStart = this.config.rows - this.config.footerHeight + 1;
      this.stream.write(`${MOVE_TO_ROW.replace('%d', String(footerStart + 1))}${CLEAR_LINE}`);
      this.stream.write(this.padLine(DIM + statusLine + RESET_ALL, this.config.columns, false));
    }
  }

  /**
   * Set the scroll region ANSI sequence.
   */
  private setScrollRegion(): void {
    const scrollEnd = this.config.rows - this.config.footerHeight;
    this.stream.write(SET_SCROLL_REGION.replace('%d', String(scrollEnd)));
  }

  /**
   * Pad a line to fill the terminal width (clears any remaining characters).
   * If hasBackground is true, the padding will have the background color.
   */
  private padLine(line: string, width: number, hasBackground = false): string {
    const visibleLen = this.getVisibleLength(line);
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
    const visibleLen = this.getVisibleLength(line);
    if (visibleLen >= width) {
      // Line is too long, truncate and reset
      return line.slice(0, width + (line.length - visibleLen)) + RESET_ALL;
    }
    // Add spaces to fill width (background color continues), then reset
    const padding = ' '.repeat(width - visibleLen);
    return line + padding + RESET_ALL;
  }

  /**
   * Get visible length of a string (ignoring ANSI codes).
   */
  private getVisibleLength(str: string): number {
    // Strip ANSI escape sequences
    const stripped = str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
    return stripped.length;
  }
}