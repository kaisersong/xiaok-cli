import type { ReplInputFrame } from './repl-state.js';
import { type PermissionModalRequest } from './terminal-controller.js';
export declare class ReplRenderer {
    private readonly stream;
    private readonly controller;
    private readonly terminalRenderer;
    constructor(stream?: NodeJS.WriteStream);
    private syncTerminalSize;
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
}
