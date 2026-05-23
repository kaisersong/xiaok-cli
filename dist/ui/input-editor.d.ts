export interface InputEditorState {
    draft: string;
    cursor: number;
}
export declare function insertText(state: InputEditorState, text: string): InputEditorState;
export declare function backspace(state: InputEditorState): InputEditorState;
export declare function deleteToStart(state: InputEditorState): InputEditorState;
export declare function deleteToEnd(state: InputEditorState): InputEditorState;
export declare function insertNewline(state: InputEditorState): InputEditorState;
export declare function moveLeft(state: InputEditorState): InputEditorState;
export declare function moveRight(state: InputEditorState): InputEditorState;
export declare function moveHome(state: InputEditorState): InputEditorState;
export declare function moveEnd(state: InputEditorState): InputEditorState;
