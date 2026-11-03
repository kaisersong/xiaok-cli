import type { ReplInputFrame } from './repl-state.js';
import type { ScrollRegionManager } from './scroll-region.js';
import { type PermissionModalRequest } from './terminal-controller.js';
export declare class ReplRenderer {
    private readonly stream;
    private readonly controller;
    private readonly terminalRenderer;
    private scrollRegion;
    private permissionScreen;
    private permissionInvalidated;
    private permissionNeedsScreen;
    private onPermissionInvalidated;
    private permissionCompletion;
    private readonly invalidatePermissionScreen;
    private releasePermissionScreen;
    private readonly repaintPermissionScreen;
    canApprovePermissionModal(): boolean;
    pagePermissionModal(delta: number): void;
    private finishPermissionScreen;
    private inputOverlayKind;
    constructor(stream?: NodeJS.WriteStream);
    private syncTerminalSize;
    setScrollRegion(region: ScrollRegionManager): void;
    hasActiveScrollRegion(): boolean;
    private getScrollPromptFrame;
    private buildPermissionOverlayLines;
    private render;
    getState(): import("./surface-state.js").SurfaceState;
    renderInput(frame: ReplInputFrame, overlayKind?: 'generic' | 'question'): void;
    renderOverlayAtCursor(lines: string[]): void;
    openPermissionModal(request: PermissionModalRequest, onInvalidated?: () => void): () => void;
    handleKey(key: string): void;
    clearOverlay(): void;
    closeModal(): void;
    clearVisibleContent(): void;
    clearPromptLine(): void;
    prepareBlockOutput(): void;
    /**
     * Restore expected line count after scroll region's endContentStreaming,
     * so the next TerminalRenderer render uses cursor movement not newlines.
     */
    prepareForInput(): void;
}
