export interface InputStateSnapshot {
    value: string;
    cursorOffset: number;
    history: string[];
}
export interface InputModel {
    getState(): InputStateSnapshot;
    insertText(text: string): void;
    moveLeft(): void;
    moveRight(): void;
    backspace(): void;
    setValue(value: string, cursorOffset?: number): void;
    pushHistorySnapshot(): void;
}
export declare function createInputModel(initialValue?: string, initialCursorOffset?: number): InputModel;
