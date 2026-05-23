import { type Action } from './keybindings.js';
import type { InputPasteController } from './input-paste.js';
export interface InputEngineSnapshot {
    draft: string;
    cursor: number;
}
export type InputEngineChangeReason = 'edit' | 'move' | 'policy';
export interface InputEnginePolicy {
    onSubmit(text: string): InputEngineSnapshot | void;
    onCancel(): InputEngineSnapshot | void;
    onChange(snapshot: InputEngineSnapshot, reason: InputEngineChangeReason): void;
    onUnhandledAction?: (action: Action, snapshot: InputEngineSnapshot) => boolean | InputEngineSnapshot | void;
    allowSlashMenu?: boolean;
    allowHistoryRecall?: boolean;
    allowQueuedSlotEditing?: boolean;
}
export interface InputEngineOptions {
    initialSnapshot?: Partial<InputEngineSnapshot>;
    pasteController: InputPasteController;
    policy: InputEnginePolicy;
}
export interface InputEngine {
    handleChunk(raw: string): boolean;
    handleAction(action: Action): boolean;
    getSnapshot(): InputEngineSnapshot;
    setSnapshot(snapshot: Partial<InputEngineSnapshot>): void;
}
export declare function normalizeBatchedInput(raw: string): string;
export declare function createInputEngine(options: InputEngineOptions): InputEngine;
