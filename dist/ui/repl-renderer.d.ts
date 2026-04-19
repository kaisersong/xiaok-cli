import type { ReplInputFrame } from './repl-state.js';
import type { ScrollRegionManager } from './scroll-region.js';
import { type PermissionModalRequest } from './terminal-controller.js';
export declare class ReplRenderer {
    private readonly stream;
    private readonly controller;
    private readonly terminalRenderer;
    private scrollRegion;
    constructor(stream?: NodeJS.WriteStream);
    private syncTerminalSize;
    setScrollRegion(region: ScrollRegionManager): void;
    hasActiveScrollRegion(): boolean;
    private getScrollPromptFrame;
    private buildPermissionOverlayLines;
    private render;
    getState(): import("./surface-state.js").SurfaceState;
    renderInput(frame: ReplInputFrame): void;
    renderOverlayAtCursor(lines: string[]): void;
    openPermissionModal(request: PermissionModalRequest): void;
    handleKey(key: string): void;
    clearOverlay(): void;
    closeModal(): void;
    clearPromptLine(): void;
    prepareBlockOutput(): void;
    /**
     * Restore expected line count after scroll region's endContentStreaming,
     * so the next TerminalRenderer render uses cursor movement not newlines.
     */
    prepareForInput(): void;
}
