import type { SurfaceState } from './surface-state.js';
export declare class TerminalRenderer {
    private readonly stream;
    private previousLineCount;
    constructor(stream?: NodeJS.WriteStream);
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
}
