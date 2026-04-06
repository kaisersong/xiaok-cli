import type { WriteStream } from 'node:tty';
import { buildTerminalFrame } from './terminal-frame.js';
import type { SurfaceState } from './surface-state.js';

export class TerminalRenderer {
  private previousLineCount = 0;

  constructor(private readonly stream: NodeJS.WriteStream = process.stdout) {}

  render(state: SurfaceState): void {
    const frame = buildTerminalFrame(state);
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
}
