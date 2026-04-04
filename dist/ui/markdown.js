import { bold, dim, cyan, green, magenta, getTheme } from "./render.js";
import { highlightLine } from "./highlight.js";
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
    /** Feed a text chunk (may be partial line). */
    write(text) {
        this.buffer += text;
        let nlIdx;
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
    flush() {
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
    reset() {
        this.buffer = "";
        this.inCodeBlock = false;
        this.codeLang = "";
        this.pendingLen = 0;
    }
    renderLine(line) {
        const theme = getTheme();
        // Code block fences
        if (line.trimStart().startsWith("```")) {
            if (this.inCodeBlock) {
                this.inCodeBlock = false;
                this.codeLang = "";
                if (theme === "default")
                    process.stdout.write(`${BODY_GUTTER}${dim("╰─")}`);
                else
                    process.stdout.write(BODY_GUTTER);
            }
            else {
                this.inCodeBlock = true;
                const lang = line.trimStart().slice(3).trim();
                this.codeLang = lang.toLowerCase();
                if (theme === "default")
                    process.stdout.write(`${BODY_GUTTER}${dim(`╭─ ${lang ? magenta(lang) : ""}`)}`);
                else
                    process.stdout.write(BODY_GUTTER);
            }
            return;
        }
        // Inside code block
        if (this.inCodeBlock) {
            const highlighted = this.codeLang ? highlightLine(line, this.codeLang) : green(line);
            if (theme === "default") {
                process.stdout.write(`${BODY_GUTTER}${dim("│")} ${highlighted}`);
            }
            else {
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
    inlineFormat(text) {
        text = text.replace(/`([^`]+)`/g, (_, code) => cyan(code));
        text = text.replace(/\*\*\*(.+?)\*\*\*/g, (_, s) => bold(s));
        text = text.replace(/\*\*(.+?)\*\*\*/g, (_, s) => bold(s));
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
}
