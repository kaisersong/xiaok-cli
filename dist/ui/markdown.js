import { accentAmber, accentBlue, accentGreen, accentPurple, boldAccentAmber, boldAccentBlue, dim, green, magenta, getTheme, } from "./render.js";
import { highlightLine } from "./highlight.js";
import { getDisplayWidth, isFullWidthCodePoint, stripAnsi } from "./text-metrics.js";
import { renderMermaidASCII } from "beautiful-mermaid";
import { renderMarkdownTable, splitTableRow, tableAlignment, tableDisplayWidth } from './markdown-table.js';
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
    buffer = "";
    tableCandidate = null;
    table = null;
    inCodeBlock = false;
    codeLang = "";
    mermaidBuffer = [];
    lineCount = 0;
    termWidth = 0;
    consecutiveBlankLines = 0;
    hasRenderedLeadParagraph = false;
    /** Optional callback for newline output (e.g., scroll-region-aware). */
    newlineFn = null;
    /** Optional callback reporting visible columns advanced within a rendered row. */
    columnAdvanceFn = null;
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
    /**
     * Set a callback that receives the visible width written inside a rendered
     * row. Without it the cursor column tracked by the caller would stay at 0 for
     * rows that do not end in a newline, and the next absolute reposition would
     * overwrite them from column 0.
     */
    setColumnAdvanceCallback(callback) {
        this.columnAdvanceFn = callback;
    }
    emitNewline() {
        if (this.newlineFn) {
            this.newlineFn();
        }
        else {
            process.stdout.write("\n");
        }
    }
    /**
     * Write already-formatted text, routing every embedded newline through the
     * newline callback so the caller's row bookkeeping sees soft-wrapped rows.
     * Byte output is identical to a single write of `rendered`.
     */
    emitRendered(rendered, measureWidth = getDisplayWidth) {
        const rows = rendered.split("\n");
        rows.forEach((row, index) => {
            if (row)
                process.stdout.write(row);
            if (index < rows.length - 1) {
                this.emitNewline();
            }
            else if (row) {
                this.columnAdvanceFn?.(measureWidth(stripAnsi(row)));
            }
        });
    }
    /** Feed a text chunk (may be partial line). */
    write(text) {
        this.buffer += text;
        let nlIdx;
        while ((nlIdx = this.buffer.indexOf("\n")) !== -1) {
            const line = this.buffer.slice(0, nlIdx);
            this.buffer = this.buffer.slice(nlIdx + 1);
            this.processLine(line, true);
        }
    }
    writeRegularLine(line, complete) {
        const rendered = this.formatLine(line);
        this.lineCount += this.countRenderedRows(rendered);
        const isBlank = line.trim() === '';
        if (isBlank && !this.inCodeBlock && complete) {
            this.consecutiveBlankLines++;
            if (this.consecutiveBlankLines > 1)
                return '';
            this.emitRendered(rendered);
            this.emitNewline();
            return rendered + '\n';
        }
        this.consecutiveBlankLines = 0;
        this.emitRendered(rendered);
        if (complete)
            this.emitNewline();
        return rendered + (complete ? '\n' : '');
    }
    emitTable(complete) {
        if (!this.table)
            return '';
        const table = this.table;
        if (table.records && !table.rows.length)
            return '';
        const lines = renderMarkdownTable(table, this.termWidth || process.stdout.columns || 80, text => this.inlineFormat(text), table.records);
        const rendered = lines.join('\n');
        this.hasRenderedLeadParagraph = true;
        this.consecutiveBlankLines = 0;
        this.emitRendered(rendered, tableDisplayWidth);
        this.lineCount += lines.length;
        if (complete)
            this.emitNewline();
        return rendered + (complete ? '\n' : '');
    }
    finishTable(complete) {
        const rendered = this.emitTable(complete);
        this.table = null;
        return rendered;
    }
    processLine(line, complete) {
        let emitted = '';
        if (this.table) {
            const cells = splitTableRow(line);
            if (cells && cells.length === this.table.header.length && !line.trimStart().startsWith('```')) {
                this.table.rows.push(cells);
                this.table.bytes += line.length;
                this.table.complete = complete;
                if (this.table.records || this.table.rows.length >= 128 || this.table.bytes >= 65536) {
                    this.table.records = true;
                    emitted += this.emitTable(true);
                    this.table.rows = [];
                    this.table.bytes = 0;
                }
                return emitted;
            }
            emitted += this.finishTable(true);
            // Malformed rows remain visible rather than silently dropping extra cells.
            if (cells)
                return emitted + this.writeRegularLine(line, complete);
        }
        if (this.tableCandidate) {
            const candidate = this.tableCandidate;
            this.tableCandidate = null;
            const header = splitTableRow(candidate.line);
            const alignment = tableAlignment(line, header.length);
            if (alignment) {
                this.table = { header, alignment, rows: [], bytes: candidate.line.length + line.length, records: false, complete };
                return emitted;
            }
            emitted += this.writeRegularLine(candidate.line, candidate.complete);
        }
        if (!this.inCodeBlock && !line.trimStart().startsWith('```') && splitTableRow(line)) {
            this.tableCandidate = { line, complete };
            return emitted;
        }
        return emitted + this.writeRegularLine(line, complete);
    }
    /** Commit pending prose or a complete/partial table at a stream boundary. */
    flush() {
        const before = this.lineCount;
        let renderedLine = '';
        if (this.buffer) {
            const tail = this.buffer;
            this.buffer = '';
            renderedLine += this.processLine(tail, false);
        }
        if (this.table)
            renderedLine += this.finishTable(this.table.complete);
        if (this.tableCandidate) {
            const candidate = this.tableCandidate;
            this.tableCandidate = null;
            renderedLine += this.writeRegularLine(candidate.line, candidate.complete);
        }
        return { rows: this.lineCount - before, renderedLine };
    }
    /** Reset state between messages. */
    reset() {
        this.buffer = "";
        this.tableCandidate = null;
        this.table = null;
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
    beginNewSegment() {
        this.flush();
        this.hasRenderedLeadParagraph = false;
        this.consecutiveBlankLines = 0;
    }
    formatLine(line) {
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
                    }
                    catch {
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
            const useLeadMarker = !this.hasRenderedLeadParagraph;
            this.hasRenderedLeadParagraph = true;
            return this.formatMessageText(boldAccentBlue(headerMatch[2]), useLeadMarker);
        }
        // Blockquotes
        if (line.startsWith("> ")) {
            return `${BODY_GUTTER}${accentAmber("│")} ${accentAmber(this.inlineFormat(line.slice(2)))}`;
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
                markerRendered: `${accentPurple('•')} `,
                content: ulMatch[2],
            });
        }
        const olMatch = line.match(/^(\s*)(\d+)\.\s+(.*)/);
        if (olMatch) {
            this.hasRenderedLeadParagraph = true;
            return this.formatWrappedListItem({
                indent: olMatch[1],
                markerText: `${olMatch[2]}. `,
                markerRendered: `${accentPurple(olMatch[2] + '.')} `,
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
    countRows(text) {
        const displayWidth = getDisplayWidth(stripAnsi(text));
        const cols = this.termWidth || process.stdout.columns || 80;
        return Math.max(1, Math.ceil(displayWidth / cols));
    }
    countRenderedRows(text) {
        const lines = text.split('\n');
        return lines.reduce((sum, line) => sum + this.countRows(line), 0);
    }
    formatLeadParagraphLine(line) {
        const renderedText = this.inlineFormat(line);
        return this.formatMessageText(renderedText, true);
    }
    formatMessageText(renderedText, useLeadMarker) {
        const plainPrefix = useLeadMarker
            ? `${BODY_GUTTER}${LEAD_PREFIX_TEXT}`
            : `${BODY_GUTTER}${LEAD_CONTINUATION_PREFIX}`;
        const plainContinuationPrefix = `${BODY_GUTTER}${LEAD_CONTINUATION_PREFIX}`;
        const firstLineWidth = this.getWrapWidth(plainPrefix);
        const continuationWidth = this.getWrapWidth(plainContinuationPrefix);
        const wrappedLines = this.wrapStyledText(renderedText, firstLineWidth, continuationWidth);
        const bullet = accentBlue(LEAD_BULLET);
        return wrappedLines
            .map((wrappedLine, index) => {
            const prefix = index === 0 && useLeadMarker
                ? `${BODY_GUTTER}${bullet} `
                : plainContinuationPrefix;
            return `${prefix}${wrappedLine}`;
        })
            .join('\n');
    }
    formatWrappedListItem(input) {
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
    getWrapWidth(prefix) {
        const cols = this.termWidth || process.stdout.columns || 80;
        return Math.max(8, cols - getDisplayWidth(stripAnsi(prefix)));
    }
    wrapStyledText(text, firstLineWidth, continuationWidth) {
        const lines = [];
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
            const codePoint = text.codePointAt(i);
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
            }
            else {
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
    inlineFormat(text) {
        text = text.replace(/`([^`]+)`/g, (_, code) => accentGreen(code));
        text = text.replace(/\*\*\*(.+?)\*\*\*/g, (_, s) => boldAccentAmber(s));
        text = text.replace(/\*\*(.+?)\*\*/g, (_, s) => boldAccentAmber(s));
        text = text.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, (_, s) => accentPurple(s));
        text = text.replace(/~~(.+?)~~/g, (_, s) => dim(s));
        return text;
    }
    /**
     * Render markdown text to an array of ANSI-formatted lines.
     * Does not write to stdout — returns lines for embedding in other UI.
     */
    static renderToLines(text) {
        const renderer = new MarkdownRenderer();
        const originalWrite = process.stdout.write;
        let captured = '';
        try {
            process.stdout.write = ((chunk) => {
                captured += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
                return true;
            });
            renderer.write(text);
            renderer.flush();
        }
        finally {
            process.stdout.write = originalWrite;
        }
        return captured.replace(/\n$/, '').split('\n');
    }
}
