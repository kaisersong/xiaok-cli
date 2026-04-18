import type { WriteStream } from 'node:tty';
import { buildTerminalFrame } from './terminal-frame.js';
import type { SurfaceState } from './surface-state.js';

export class TerminalRenderer {
  private previousLineCount = 0;
  private inputAreaPosition: number | null = null; // Track input area starting line

  constructor(private readonly stream: NodeJS.WriteStream = process.stdout) {}

  /**
   * Mark current position as input area anchor point.
   * Call this after output content completes, before starting input.
   */
  anchorInputPosition(): void {
    // After output, cursor is at the line after the last output line.
    // The input area will be rendered here (at the bottom of visible content).
    // We don't move cursor - we just record that future renders should happen at this position.
    this.inputAreaPosition = null; // Will be established on first render
  }

  render(state: SurfaceState): void {
    const frame = buildTerminalFrame(state);
    const isInitialRender = this.previousLineCount === 0;

    // On initial render, we need to establish the input area position.
    // Cursor is at the line after output content.
    // We render the input frame directly here, without clearing anything above.
    if (isInitialRender) {
      // Just render the input frame lines at current position
      frame.lines.forEach((line, index) => {
        this.stream.write('\x1b[2K'); // Clear current line
        this.stream.write(line);
        if (index < frame.lines.length - 1) {
          this.stream.write('\n');
        }
      });

      // Position cursor correctly
      if (frame.cursor) {
        // Cursor should be on the prompt line (index 0)
        // We're at the last line, need to move up
        const lineDelta = frame.lines.length - 1 - frame.cursor.line;
        if (lineDelta > 0) {
          this.stream.write(`\x1b[${lineDelta}A`);
        }
        this.stream.write('\r');
        if (frame.cursor.column > 0) {
          this.stream.write(`\x1b[${frame.cursor.column}C`);
        }
      } else if (frame.lines.length > 1) {
        // Move to first line of input area
        this.stream.write(`\x1b[${frame.lines.length - 1}A`);
        this.stream.write('\r');
      }

      this.previousLineCount = frame.lines.length;
      return;
    }

    // Subsequent renders: clear previous input area and re-render
    // We need to clear exactly the previous input area lines
    const linesToClear = Math.max(this.previousLineCount, frame.lines.length);

    this.stream.write('\r');
    for (let index = 0; index < linesToClear; index += 1) {
      this.stream.write('\x1b[2K');
      if (index < linesToClear - 1) {
        this.stream.write('\x1b[1B');
        this.stream.write('\r');
      }
    }
    if (linesToClear > 1) {
      this.stream.write(`\x1b[${linesToClear - 1}A`);
    }
    this.stream.write('\r');

    frame.lines.forEach((line, index) => {
      this.stream.write('\x1b[2K');
      this.stream.write(line);
      if (index < frame.lines.length - 1) {
        this.stream.write('\x1b[1B');
        this.stream.write('\r');
      }
    });

    if (frame.cursor) {
      const lineDelta = frame.lines.length - 1 - frame.cursor.line;
      if (lineDelta > 0) {
        this.stream.write(`\x1b[${lineDelta}A`);
      }
      this.stream.write('\r');
      if (frame.cursor.column > 0) {
        this.stream.write(`\x1b[${frame.cursor.column}C`);
      }
    } else if (frame.lines.length > 1) {
      this.stream.write(`\x1b[${frame.lines.length - 1}A`);
      this.stream.write('\r');
    }

    this.previousLineCount = frame.lines.length;
  }

  /**
   * Clear all rendered lines and reset state. Call this before outputting content.
   * Note: After render(), cursor is at the FIRST line of the input area.
   * We only need to clear from current position, not move up.
   */
  clearAll(): void {
    if (this.previousLineCount > 0) {
      // 光标在输入栏第一行，清除当前行和下面的行
      for (let i = 0; i < this.previousLineCount; i++) {
        this.stream.write('\x1b[2K');
        if (i < this.previousLineCount - 1) {
          this.stream.write('\x1b[1B');
        }
      }
      // 回到输入栏第一行的位置（准备输出新内容）
      if (this.previousLineCount > 1) {
        this.stream.write(`\x1b[${this.previousLineCount - 1}A`);
      }
      this.stream.write('\r');
      this.previousLineCount = 0;
    }
  }

  /**
   * Reset state without rendering. Call this before outputting content
   * that will move the cursor to a new position.
   */
  reset(): void {
    this.previousLineCount = 0;
  }

  /**
   * Set the expected input area line count so subsequent renders
   * use cursor movement (\x1b[1B) instead of newlines (\n).
   */
  setExpectedLineCount(n: number): void {
    this.previousLineCount = n;
  }
}
