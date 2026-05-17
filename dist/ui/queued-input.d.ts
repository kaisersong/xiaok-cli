export interface QueuedInputSlot {
    text: string;
    queuedAt: number;
}
export interface QueuedInputSnapshot {
    draft: string;
    cursor: number;
    queued: QueuedInputSlot | null;
    editingQueued: boolean;
}
export type QueuedInputMutation = {
    type: 'none';
} | {
    type: 'submit';
    value: string;
} | {
    type: 'replace';
    oldValue: string;
    newValue: string;
} | {
    type: 'edit';
    value: string;
} | {
    type: 'clear-draft';
    value: string;
};
export interface QueuedInputState {
    getSnapshot(): QueuedInputSnapshot;
    insertText(text: string): void;
    setDraft(text: string, cursor?: number): void;
    moveLeft(): void;
    moveRight(): void;
    moveHome(): void;
    moveEnd(): void;
    backspace(): void;
    deleteToStart(): void;
    insertNewline(): void;
    submitDraft(now?: number): QueuedInputMutation;
    editQueued(): QueuedInputMutation;
    handleEscape(): QueuedInputMutation;
    consumeQueued(): string | null;
}
export declare function createQueuedInputState(initial?: Partial<QueuedInputSnapshot>): QueuedInputState;
