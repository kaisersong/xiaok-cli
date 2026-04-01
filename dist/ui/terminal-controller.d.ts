import type { SlashOverlayItem } from './overlay-state.js';
import type { SurfaceState } from './surface-state.js';
export interface PermissionModalRequest {
    toolName: string;
    targetLines: string[];
    options: string[];
}
export interface TerminalController {
    getState(): SurfaceState;
    setPrompt(prompt: string): void;
    setTerminalSize(columns: number, rows: number): void;
    setSlashCommands(commands: SlashOverlayItem[]): void;
    setOverlayLines(lines: string[]): void;
    insertText(text: string): void;
    moveCursorLeft(): void;
    moveCursorRight(): void;
    backspace(): void;
    handleKey(key: string): void;
    replaceInput(value: string, cursorOffset?: number): void;
    openPermissionModal(request: PermissionModalRequest): void;
    closeModal(): void;
    clearOverlay(): void;
    consumeSubmission(): string | null;
}
export declare function createTerminalController({ prompt }: {
    prompt: string;
}): TerminalController;
