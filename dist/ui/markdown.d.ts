/**
 * Line-buffered markdown renderer for streaming terminal output.
 * Buffers text until newlines, then renders each complete line
 * with ANSI formatting. Tracks code block state across lines.
 */
export declare class MarkdownRenderer {
    private buffer;
    private inCodeBlock;
    private codeLang;
    private pendingLen;
    private lineCount;
    private termWidth;
    private consecutiveBlankLines;
    /** Optional callback for newline output (e.g., scroll-region-aware). */
    private newlineFn;
    /** Get the number of content lines written (for cursor positioning). */
    getLineCount(termWidth?: number): number;
    /**
     * Set a custom newline callback. When set, this function is called
     * instead of writing '\n' to stdout.
     */
    setNewlineCallback(callback: (() => void) | null): void;
    /** Feed a text chunk (may be partial line). */
    write(text: string): void;
    /** Flush remaining buffer and return the number of terminal rows finalized. */
    flush(): number;
    /** Reset state between messages. */
    reset(): void;
    private renderLine;
    private countRows;
    /** Apply inline formatting. */
    private inlineFormat;
    private getPendingPrefix;
    /**
     * Render markdown text to an array of ANSI-formatted lines.
     * Does not write to stdout — returns lines for embedding in other UI.
     */
    static renderToLines(text: string): string[];
}
