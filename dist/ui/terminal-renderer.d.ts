import type { SurfaceState } from './surface-state.js';
export declare class TerminalRenderer {
    private readonly stream;
    private previousLineCount;
    private inputAreaPosition;
    constructor(stream?: NodeJS.WriteStream);
    /**
     * Mark current position as input area anchor point.
     * Call this after output content completes, before starting input.
     */
    anchorInputPosition(): void;
    render(state: SurfaceState): void;
    /**
     * Clear all rendered lines and reset state. Call this before outputting content.
     * Note: After render(), cursor is at the FIRST line of the input area.
     * We only need to clear from current position, not move up.
     */
    clearAll(): void;
    /**
     * Reset state without rendering. Call this before outputting content
     * that will move the cursor to a new position.
     */
    reset(): void;
    /**
     * Set the expected input area line count so subsequent renders
     * use cursor movement (\x1b[1B) instead of newlines (\n).
     */
    setExpectedLineCount(n: number): void;
}
