import { bold, dim, cyan, green, magenta, getTheme } from "./render.js";
import { highlightLine } from "./highlight.js";
import { getDisplayWidth, stripAnsi } from "./text-metrics.js";
const BODY_GUTTER = "";
/**
 * Line-buffered markdown renderer for streaming terminal output.
 * Buffers text until newlines, then renders each complete line
 * with ANSI formatting. Tracks code block state across lines.
 */
export class MarkdownRenderer {
    buffer = "";
    inCodeBlock = false;
    codeLang = "";
    pendingLen = 0;
    lineCount = 0;
    termWidth = 0;
    consecutiveBlankLines = 0;
    /** Optional callback for newline output (e.g., scroll-region-aware). */
    newlineFn = null;
    /** Get the number of content lines written (for cursor positioning). */
    getLineCount(termWidth) {
        if (termWidth)
            this.termWidth = termWidth;
        return this.lineCount;
    }
    /**
     * Set a custom newline callback. When set, this function is called
     * instead of writing '\n' to stdout.
     */
    setNewlineCallback(callback) {
        this.newlineFn = callback;
    }
    /** Feed a text chunk (may be partial line). */
    write(text) {
        this.buffer += text;
        let nlIdx;
        while ((nlIdx = this.buffer.indexOf("\n")) !== -1) {
            const line = this.buffer.slice(0, nlIdx);
            this.buffer = this.buffer.slice(nlIdx + 1);
            // If there's pending partial text, incorporate it into this line.
            // Only clear+re-render if the pending text adds NEW content beyond
            // what renderLine already wrote (i.e., the line was updated mid-stream).
            if (this.pendingLen > 0 && this.pendingLen < line.length) {
                // Streaming update: new chars arrived after initial render.
                // Clear the old render and re-render with the full line.
                process.stdout.write(`\r\x1b[2K`);
                this.renderLine(line);
            }
            else if (this.pendingLen > 0 && this.pendingLen >= line.length) {
                // Full line was already rendered (or over-rendered) by pending.
                // Just move cursor to next line without re-rendering.
            }
            else {
                // No pending text — this is a fresh complete line.
                this.renderLine(line);
            }
            this.pendingLen = 0;
            const isBlank = line.trim() === "";
            // Skip all blank lines outside code blocks to prevent
            // extra \n from pushing content into footer area.
            if (isBlank && !this.inCodeBlock) {
                this.consecutiveBlankLines++;
                // Still call newline callback for standalone blank lines between content
                // to ensure cursor moves to next row.
                if (this.newlineFn) {
                    this.newlineFn();
                }
                else {
                    process.stdout.write("\n");
                }
                continue;
            }
            this.consecutiveBlankLines = 0;
            if (this.newlineFn) {
                this.newlineFn();
            }
            else {
                process.stdout.write("\n");
            }
            // Track line count including terminal wrapping
            const displayWidth = getDisplayWidth(stripAnsi(line));
            const cols = this.termWidth || process.stdout.columns || 80;
            const wrappedLines = Math.max(1, Math.ceil(displayWidth / cols));
            this.lineCount += wrappedLines;
        }
        // Write remaining buffer as partial line (streaming text without newline).
        // Only write new characters beyond what's already displayed.
        if (this.buffer.length > this.pendingLen) {
            const newChars = this.buffer.slice(this.pendingLen);
            if (this.pendingLen === 0) {
                process.stdout.write(this.getPendingPrefix());
            }
            process.stdout.write(newChars);
            this.pendingLen = this.buffer.length;
        }
    }
    /** Flush remaining buffer and return the finalized row count plus rendered tail text. */
    flush() {
        let flushedRows = 0;
        let renderedLine = '';
        if (this.buffer) {
            if (this.pendingLen > 0) {
                process.stdout.write(`\r\x1b[2K`);
                this.pendingLen = 0;
            }
            const flushed = this.buffer;
            renderedLine = this.formatLine(flushed);
            process.stdout.write(renderedLine);
            flushedRows = this.countRows(flushed);
            this.lineCount += flushedRows;
            this.buffer = "";
        }
        // Reset pendingLen after flush to prevent subsequent write() calls
        // from clearing the line where the flushed content was written.
        // This can happen if the footer has been rendered between flush()
        // and the next write().
        this.pendingLen = 0;
        return { rows: flushedRows, renderedLine };
    }
    /** Reset state between messages. */
    reset() {
        this.buffer = "";
        this.inCodeBlock = false;
        this.codeLang = "";
        this.pendingLen = 0;
        this.lineCount = 0;
        this.consecutiveBlankLines = 0;
        this.newlineFn = null;
    }
    renderLine(line) {
        process.stdout.write(this.formatLine(line));
    }
    formatLine(line) {
        const theme = getTheme();
        // Code block fences
        if (line.trimStart().startsWith("```")) {
            if (this.inCodeBlock) {
                this.inCodeBlock = false;
                this.codeLang = "";
                return theme === "default" ? `${BODY_GUTTER}${dim("╰─")}` : BODY_GUTTER;
            }
            this.inCodeBlock = true;
            const lang = line.trimStart().slice(3).trim();
            this.codeLang = lang.toLowerCase();
            return theme === "default"
                ? `${BODY_GUTTER}${dim(`╭─ ${lang ? magenta(lang) : ""}`)}`
                : BODY_GUTTER;
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
            return `${BODY_GUTTER}${dim("─".repeat(40))}`;
        }
        // List items
        const ulMatch = line.match(/^(\s*)[-*+]\s+(.*)/);
        if (ulMatch) {
            return `${BODY_GUTTER}${ulMatch[1]}${dim("•")} ${this.inlineFormat(ulMatch[2])}`;
        }
        const olMatch = line.match(/^(\s*)(\d+)\.\s+(.*)/);
        if (olMatch) {
            return `${BODY_GUTTER}${olMatch[1]}${dim(olMatch[2] + ".")} ${this.inlineFormat(olMatch[3])}`;
        }
        // Regular text
        return `${BODY_GUTTER}${this.inlineFormat(line)}`;
    }
    countRows(text) {
        const displayWidth = getDisplayWidth(stripAnsi(text));
        const cols = this.termWidth || process.stdout.columns || 80;
        return Math.max(1, Math.ceil(displayWidth / cols));
    }
    /** Apply inline formatting. */
    inlineFormat(text) {
        text = text.replace(/`([^`]+)`/g, (_, code) => cyan(code));
        text = text.replace(/\*\*\*(.+?)\*\*\*/g, (_, s) => bold(s));
        text = text.replace(/\*\*(.+?)\*\*/g, (_, s) => bold(s));
        text = text.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, (_, s) => dim(s));
        text = text.replace(/~~(.+?)~~/g, (_, s) => dim(s));
        return text;
    }
    getPendingPrefix() {
        if (this.inCodeBlock && getTheme() === "default") {
            return `${BODY_GUTTER}${dim("│")} `;
        }
        return BODY_GUTTER;
    }
    /**
     * Render markdown text to an array of ANSI-formatted lines.
     * Does not write to stdout — returns lines for embedding in other UI.
     */
    static renderToLines(text) {
        // Process line-by-line directly, bypassing the streaming pending-line logic
        const r = new MarkdownRenderer();
        const inputLines = text.split('\n');
        const result = [];
        const orig = process.stdout.write.bind(process.stdout);
        for (const line of inputLines) {
            let captured = '';
            process.stdout.write = (chunk) => {
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
        process.stdout.write = (chunk) => {
            const s = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
            tail += s;
            return true;
        };
        r.flush();
        process.stdout.write = orig;
        if (tail)
            result.push(tail.replace(/\n$/, ''));
        return result;
    }
}
