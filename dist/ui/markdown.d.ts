/**
 * Line-buffered markdown renderer for streaming terminal output.
 * Buffers text until newlines, then renders each complete line
 * with ANSI formatting. Tracks code block state across lines.
 */
export declare class MarkdownRenderer {
    private buffer;
    private inCodeBlock;
    private codeLang;
    private mermaidBuffer;
    private lineCount;
    private termWidth;
    private consecutiveBlankLines;
    private hasRenderedLeadParagraph;
    /** Optional callback for newline output (e.g., scroll-region-aware). */
    private newlineFn;
    /** Optional callback reporting visible columns advanced within a rendered row. */
    private columnAdvanceFn;
    /** Get the number of content lines written (for cursor positioning). */
    getLineCount(termWidth?: number): number;
    /**
     * Set a custom newline callback. When set, this function is called
     * instead of writing '\n' to stdout.
     */
    setNewlineCallback(callback: (() => void) | null): void;
    /**
     * Set a callback that receives the visible width written inside a rendered
     * row. Without it the cursor column tracked by the caller would stay at 0 for
     * rows that do not end in a newline, and the next absolute reposition would
     * overwrite them from column 0.
     */
    setColumnAdvanceCallback(callback: ((visibleWidth: number) => void) | null): void;
    private emitNewline;
    /**
     * Write already-formatted text, routing every embedded newline through the
     * newline callback so the caller's row bookkeeping sees soft-wrapped rows.
     * Byte output is identical to a single write of `rendered`.
     */
    private emitRendered;
    /** Feed a text chunk (may be partial line). */
    write(text: string): void;
    /** Flush remaining buffer and return the finalized row count plus rendered tail text. */
    flush(): {
        rows: number;
        renderedLine: string;
    };
    /** Reset state between messages. */
    reset(): void;
    /**
     * Start a fresh assistant segment inside the same turn.
     * Used after transcript interruptions such as tool activity blocks so the
     * next natural-language continuation gets a new lead bullet + hanging indent.
     */
    beginNewSegment(): void;
    private renderLine;
    private formatLine;
    private countRows;
    private countRenderedRows;
    private formatLeadParagraphLine;
    private formatWrappedListItem;
    private getWrapWidth;
    private wrapStyledText;
    /** Apply inline formatting. */
    private inlineFormat;
    /**
     * Render markdown text to an array of ANSI-formatted lines.
     * Does not write to stdout — returns lines for embedding in other UI.
     */
    static renderToLines(text: string): string[];
}
