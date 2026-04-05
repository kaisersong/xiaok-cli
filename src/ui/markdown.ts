import { bold, dim, cyan, yellow, green, magenta, getTheme } from "./render.js";
import { highlightLine } from "./highlight.js";

const BODY_GUTTER = "";

/**
 * Line-buffered markdown renderer for streaming terminal output.
 * Buffers text until newlines, then renders each complete line
 * with ANSI formatting. Tracks code block state across lines.
 */
export class MarkdownRenderer {
  private buffer = "";
  private inCodeBlock = false;
  private codeLang = "";
  private pendingLen = 0;

  /** Feed a text chunk (may be partial line). */
  write(text: string): void {
    this.buffer += text;

    let nlIdx: number;
    while ((nlIdx = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, nlIdx);
      this.buffer = this.buffer.slice(nlIdx + 1);

      if (this.pendingLen > 0) {
        process.stdout.write(`\r\x1b[2K`);
        this.pendingLen = 0;
      }

      this.renderLine(line);
      process.stdout.write("\n");
    }

    if (this.buffer.length > this.pendingLen) {
      const newChars = this.buffer.slice(this.pendingLen);
      if (this.pendingLen === 0) {
        process.stdout.write(this.getPendingPrefix());
      }
      process.stdout.write(newChars);
      this.pendingLen = this.buffer.length;
    }
  }

  /** Flush remaining buffer. */
  flush(): void {
    if (this.buffer) {
      if (this.pendingLen > 0) {
        process.stdout.write(`\r\x1b[2K`);
        this.pendingLen = 0;
      }
      this.renderLine(this.buffer);
      this.buffer = "";
    }
  }

  /** Reset state between messages. */
  reset(): void {
    this.buffer = "";
    this.inCodeBlock = false;
    this.codeLang = "";
    this.pendingLen = 0;
  }

  private renderLine(line: string): void {
    const theme = getTheme();

    // Code block fences
    if (line.trimStart().startsWith("```")) {
      if (this.inCodeBlock) {
        this.inCodeBlock = false;
        this.codeLang = "";
        if (theme === "default") process.stdout.write(`${BODY_GUTTER}${dim("╰─")}`);
        else process.stdout.write(BODY_GUTTER);
      } else {
        this.inCodeBlock = true;
        const lang = line.trimStart().slice(3).trim();
        this.codeLang = lang.toLowerCase();
        if (theme === "default") process.stdout.write(`${BODY_GUTTER}${dim(`╭─ ${lang ? magenta(lang) : ""}`)}`);
        else process.stdout.write(BODY_GUTTER);
      }
      return;
    }

    // Inside code block
    if (this.inCodeBlock) {
      const highlighted = this.codeLang ? highlightLine(line, this.codeLang) : green(line);
      if (theme === "default") {
        process.stdout.write(`${BODY_GUTTER}${dim("│")} ${highlighted}`);
      } else {
        process.stdout.write(`${BODY_GUTTER}${highlighted}`);
      }
      return;
    }

    // Headings
    const headerMatch = line.match(/^(#{1,6})\s+(.*)/);
    if (headerMatch) {
      process.stdout.write(`${BODY_GUTTER}${bold(headerMatch[2])}`);
      return;
    }

    // Blockquotes
    if (line.startsWith("> ")) {
      process.stdout.write(`${BODY_GUTTER}${dim("│")} ${dim(this.inlineFormat(line.slice(2)))}`);
      return;
    }

    // Horizontal rule
    if (/^[-*_]{3,}\s*$/.test(line)) {
      process.stdout.write(`${BODY_GUTTER}${dim("─".repeat(40))}`);
      return;
    }

    // List items
    const ulMatch = line.match(/^(\s*)[-*+]\s+(.*)/);
    if (ulMatch) {
      process.stdout.write(`${BODY_GUTTER}${ulMatch[1]}${dim("•")} ${this.inlineFormat(ulMatch[2])}`);
      return;
    }

    const olMatch = line.match(/^(\s*)(\d+)\.\s+(.*)/);
    if (olMatch) {
      process.stdout.write(`${BODY_GUTTER}${olMatch[1]}${dim(olMatch[2] + ".")} ${this.inlineFormat(olMatch[3])}`);
      return;
    }

    // Regular text
    process.stdout.write(`${BODY_GUTTER}${this.inlineFormat(line)}`);
  }

  /** Apply inline formatting. */
  private inlineFormat(text: string): string {
    text = text.replace(/`([^`]+)`/g, (_, code: string) => cyan(code));
    text = text.replace(/\*\*\*(.+?)\*\*\*/g, (_, s: string) => bold(s));
    text = text.replace(/\*\*(.+?)\*\*/g, (_, s: string) => bold(s));
    text = text.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, (_, s: string) => dim(s));
    text = text.replace(/~~(.+?)~~/g, (_, s: string) => dim(s));
    return text;
  }

  private getPendingPrefix(): string {
    if (this.inCodeBlock && getTheme() === "default") {
      return `${BODY_GUTTER}${dim("│")} `;
    }

    return BODY_GUTTER;
  }

  /**
   * Render markdown text to an array of ANSI-formatted lines.
   * Does not write to stdout — returns lines for embedding in other UI.
   */
  static renderToLines(text: string): string[] {
    // Process line-by-line directly, bypassing the streaming pending-line logic
    const r = new MarkdownRenderer();
    const inputLines = text.split('\n');
    const result: string[] = [];

    const orig = process.stdout.write.bind(process.stdout);
    for (const line of inputLines) {
      let captured = '';
      (process.stdout.write as unknown) = (chunk: string | Uint8Array) => {
        const s = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
        captured += s;
        return true;
      };
      // Feed line + newline so renderLine fires immediately
      r.write(line + '\n');
      process.stdout.write = orig;
      // captured ends with \n from renderLine; strip it
      result.push(captured.replace(/\n$/, ''));
    }
    // Flush any remaining buffer
    let tail = '';
    (process.stdout.write as unknown) = (chunk: string | Uint8Array) => {
      const s = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
      tail += s;
      return true;
    };
    r.flush();
    process.stdout.write = orig;
    if (tail) result.push(tail.replace(/\n$/, ''));

    return result;
  }
}
