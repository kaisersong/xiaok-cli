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
    /** Feed a text chunk (may be partial line). */
    write(text: string): void;
    /** Flush remaining buffer. */
    flush(): void;
    /** Reset state between messages. */
    reset(): void;
    private renderLine;
    /** Apply inline formatting. */
    private inlineFormat;
    private getPendingPrefix;
    /**
     * Render markdown text to an array of ANSI-formatted lines.
     * Does not write to stdout — returns lines for embedding in other UI.
     */
    static renderToLines(text: string): string[];
}
