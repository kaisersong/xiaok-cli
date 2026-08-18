import { bold, dim, cyan, yellow, green, magenta, getTheme } from "./render.js";
import { highlightLine } from "./highlight.js";
import { getDisplayWidth, isFullWidthCodePoint, stripAnsi } from "./text-metrics.js";
import { renderMermaidASCII } from "beautiful-mermaid";

const BODY_GUTTER = "";
const LEAD_BULLET = '●';
const LEAD_PREFIX_TEXT = `${LEAD_BULLET} `;
const LEAD_CONTINUATION_PREFIX = '  ';

/**
 * Line-buffered markdown renderer for streaming terminal output.
 * Buffers text until newlines, then renders each complete line
 * with ANSI formatting. Tracks code block state across lines.
 */
export class MarkdownRenderer {
  private buffer = "";
  private inCodeBlock = false;
  private codeLang = "";
  private mermaidBuffer: string[] = [];
  private lineCount = 0;
  private termWidth = 0;
  private consecutiveBlankLines = 0;
  private hasRenderedLeadParagraph = false;
  /** Optional callback for newline output (e.g., scroll-region-aware). */
  private newlineFn: (() => void) | null = null;
  /** Optional callback reporting visible columns advanced within a rendered row. */
  private columnAdvanceFn: ((visibleWidth: number) => void) | null = null;

  /** Get the number of content lines written (for cursor positioning). */
  getLineCount(termWidth?: number): number {
    if (termWidth) this.termWidth = termWidth;
    return this.lineCount;
  }

  /**
   * Set a custom newline callback. When set, this function is called
   * instead of writing '\n' to stdout.
   */
  setNewlineCallback(callback: (() => void) | null): void {
    this.newlineFn = callback;
  }

  /**
   * Set a callback that receives the visible width written inside a rendered
   * row. Without it the cursor column tracked by the caller would stay at 0 for
   * rows that do not end in a newline, and the next absolute reposition would
   * overwrite them from column 0.
   */
  setColumnAdvanceCallback(callback: ((visibleWidth: number) => void) | null): void {
    this.columnAdvanceFn = callback;
  }

  private emitNewline(): void {
    if (this.newlineFn) {
      this.newlineFn();
    } else {
      process.stdout.write("\n");
    }
  }

  /**
   * Write already-formatted text, routing every embedded newline through the
   * newline callback so the caller's row bookkeeping sees soft-wrapped rows.
   * Byte output is identical to a single write of `rendered`.
   */
  private emitRendered(rendered: string): void {
    const rows = rendered.split("\n");
    rows.forEach((row, index) => {
      if (row) process.stdout.write(row);
      if (index < rows.length - 1) {
        this.emitNewline();
      } else if (row) {
        this.columnAdvanceFn?.(getDisplayWidth(stripAnsi(row)));
      }
    });
  }

  /** Feed a text chunk (may be partial line). */
  write(text: string): void {
    this.buffer += text;

    let nlIdx: number;
    while ((nlIdx = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, nlIdx);
      this.buffer = this.buffer.slice(nlIdx + 1);

      const rendered = this.renderLine(line);
      this.lineCount += this.countRenderedRows(rendered);

      const isBlank = line.trim() === "";
      if (isBlank && !this.inCodeBlock) {
        this.consecutiveBlankLines++;
        if (this.consecutiveBlankLines > 1) {
          continue;
        }
        this.emitNewline();
        continue;
      }
      this.consecutiveBlankLines = 0;

      this.emitNewline();
    }
  }

  /** Flush remaining buffer and return the finalized row count plus rendered tail text. */
  flush(): { rows: number; renderedLine: string } {
    let flushedRows = 0;
    let renderedLine = '';

    if (this.buffer) {
      const flushed = this.buffer;
      this.buffer = "";
      renderedLine = this.formatLine(flushed);
      this.emitRendered(renderedLine);
      flushedRows = this.countRenderedRows(renderedLine);
      this.lineCount += flushedRows;
    }
    return { rows: flushedRows, renderedLine };
  }

  /** Reset state between messages. */
  reset(): void {
    this.buffer = "";
    this.inCodeBlock = false;
    this.codeLang = "";
    this.mermaidBuffer = [];
    this.lineCount = 0;
    this.consecutiveBlankLines = 0;
    this.hasRenderedLeadParagraph = false;
    this.newlineFn = null;
    this.columnAdvanceFn = null;
  }

  /**
   * Start a fresh assistant segment inside the same turn.
   * Used after transcript interruptions such as tool activity blocks so the
   * next natural-language continuation gets a new lead bullet + hanging indent.
   */
  beginNewSegment(): void {
    this.hasRenderedLeadParagraph = false;
    this.consecutiveBlankLines = 0;
  }

  private renderLine(line: string): string {
    const rendered = this.formatLine(line);
    this.emitRendered(rendered);
    return rendered;
  }

  private formatLine(line: string): string {
    const theme = getTheme();

    // Code block fences
    if (line.trimStart().startsWith("```")) {
      if (this.inCodeBlock) {
        this.inCodeBlock = false;
        if (this.codeLang === "mermaid") {
          // Render buffered mermaid diagram as ASCII
          const diagram = this.mermaidBuffer.join("\n");
          this.mermaidBuffer = [];
          this.codeLang = "";
          try {
            const ascii = renderMermaidASCII(diagram);
            return ascii;
          } catch {
            // Fall back to raw source on render error
            return diagram;
          }
        }
        this.codeLang = "";
        return theme === "default" ? `${BODY_GUTTER}${dim("╰─")}` : BODY_GUTTER;
      }
      this.inCodeBlock = true;
      const lang = line.trimStart().slice(3).trim();
      this.codeLang = lang.toLowerCase();
      if (this.codeLang === "mermaid") {
        this.mermaidBuffer = [];
        return "";
      }
      return theme === "default"
        ? `${BODY_GUTTER}${dim(`╭─ ${lang ? magenta(lang) : ""}`)}`
        : BODY_GUTTER;
    }

    // Inside mermaid block — buffer lines, output nothing until closing fence
    if (this.inCodeBlock && this.codeLang === "mermaid") {
      this.mermaidBuffer.push(line);
      return "";
    }

    // Inside code block
    if (this.inCodeBlock) {
      const highlighted = this.codeLang ? highlightLine(line, this.codeLang) : green(line);
      return theme === "default"
        ? `${BODY_GUTTER}${dim("│")} ${highlighted}`
        : `${BODY_GUTTER}${highlighted}`;
    }

    // Headings
    const headerMatch = line.match(/^(#{1,6})\s+(.*)/);
    if (headerMatch) {
      return `${BODY_GUTTER}${bold(headerMatch[2])}`;
    }

    // Blockquotes
    if (line.startsWith("> ")) {
      return `${BODY_GUTTER}${dim("│")} ${dim(this.inlineFormat(line.slice(2)))}`;
    }

    // Horizontal rule
    if (/^[-*_]{3,}\s*$/.test(line)) {
      return `\n${BODY_GUTTER}${dim("─".repeat(40))}\n`;
    }

    // List items
    const ulMatch = line.match(/^(\s*)[-*+]\s+(.*)/);
    if (ulMatch) {
      this.hasRenderedLeadParagraph = true;
      return this.formatWrappedListItem({
        indent: ulMatch[1],
        markerText: '• ',
        markerRendered: `${dim('•')} `,
        content: ulMatch[2],
      });
    }

    const olMatch = line.match(/^(\s*)(\d+)\.\s+(.*)/);
    if (olMatch) {
      this.hasRenderedLeadParagraph = true;
      return this.formatWrappedListItem({
        indent: olMatch[1],
        markerText: `${olMatch[2]}. `,
        markerRendered: `${dim(olMatch[2] + '.')} `,
        content: olMatch[3],
      });
    }

    // Regular text
    if (!this.hasRenderedLeadParagraph && line.trim().length > 0) {
      this.hasRenderedLeadParagraph = true;
      return this.formatLeadParagraphLine(line);
    }

    // Continuation text after lead paragraph - align with 2-space indent
    if (line.trim().length > 0) {
      const renderedText = this.inlineFormat(line);
      const plainPrefix = `${BODY_GUTTER}${LEAD_CONTINUATION_PREFIX}`;
      const continuationWidth = this.getWrapWidth(plainPrefix);
      const wrappedLines = this.wrapStyledText(renderedText, continuationWidth, continuationWidth);

      return wrappedLines
        .map((wrappedLine) => `${plainPrefix}${wrappedLine}`)
        .join('\n');
    }

    return `${BODY_GUTTER}${this.inlineFormat(line)}`;
  }

  private countRows(text: string): number {
    const displayWidth = getDisplayWidth(stripAnsi(text));
    const cols = this.termWidth || process.stdout.columns || 80;
    return Math.max(1, Math.ceil(displayWidth / cols));
  }

  private countRenderedRows(text: string): number {
    const lines = text.split('\n');
    return lines.reduce((sum, line) => sum + this.countRows(line), 0);
  }

  private formatLeadParagraphLine(line: string): string {
    const renderedText = this.inlineFormat(line);
    const plainPrefix = `${BODY_GUTTER}${LEAD_PREFIX_TEXT}`;
    const plainContinuationPrefix = `${BODY_GUTTER}${LEAD_CONTINUATION_PREFIX}`;
    const firstLineWidth = this.getWrapWidth(plainPrefix);
    const continuationWidth = this.getWrapWidth(plainContinuationPrefix);
    const wrappedLines = this.wrapStyledText(renderedText, firstLineWidth, continuationWidth);

    const bullet = cyan(LEAD_BULLET);

    return wrappedLines
      .map((wrappedLine, index) => {
        const prefix = index === 0
          ? `${BODY_GUTTER}${bullet} `
          : plainContinuationPrefix;
        return `${prefix}${wrappedLine}`;
      })
      .join('\n');
  }

  private formatWrappedListItem(input: {
    indent: string;
    markerText: string;
    markerRendered: string;
    content: string;
  }): string {
    const renderedText = this.inlineFormat(input.content);
    const plainPrefix = `${BODY_GUTTER}${input.indent}${input.markerText}`;
    const continuationPrefix = `${BODY_GUTTER}${' '.repeat(getDisplayWidth(`${input.indent}${input.markerText}`))}`;
    const firstLineWidth = this.getWrapWidth(plainPrefix);
    const continuationWidth = this.getWrapWidth(continuationPrefix);
    const wrappedLines = this.wrapStyledText(renderedText, firstLineWidth, continuationWidth);

    return wrappedLines
      .map((wrappedLine, index) => {
        const prefix = index === 0
          ? `${BODY_GUTTER}${input.indent}${input.markerRendered}`
          : continuationPrefix;
        return `${prefix}${wrappedLine}`;
      })
      .join('\n');
  }

  private getWrapWidth(prefix: string): number {
    const cols = this.termWidth || process.stdout.columns || 80;
    return Math.max(8, cols - getDisplayWidth(stripAnsi(prefix)));
  }

  private wrapStyledText(text: string, firstLineWidth: number, continuationWidth: number): string[] {
    const lines: string[] = [];
    let current = '';
    let currentWidth = 0;
    let currentLimit = firstLineWidth;
    const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]/y;
    let i = 0;

    while (i < text.length) {
      ANSI_RE.lastIndex = i;
      const match = ANSI_RE.exec(text);
      if (match) {
        current += match[0];
        i += match[0].length;
        continue;
      }

      const codePoint = text.codePointAt(i)!;
      const charLen = codePoint > 0xffff ? 2 : 1;
      const char = text.slice(i, i + charLen);
      const charWidth = (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f))
        ? 0
        : isFullWidthCodePoint(codePoint) ? 2 : 1;

      if (current !== '' && charWidth > 0 && currentWidth + charWidth > currentLimit) {
        lines.push(current);
        current = char;
        currentWidth = charWidth;
        currentLimit = continuationWidth;
      } else {
        current += char;
        currentWidth += charWidth;
      }
      i += charLen;
    }

    if (current.length > 0 || lines.length === 0) {
      lines.push(current);
    }

    return lines;
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
