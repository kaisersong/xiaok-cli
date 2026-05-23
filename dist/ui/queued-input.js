import { backspace as editorBackspace, deleteToStart as editorDeleteToStart, insertNewline as editorInsertNewline, insertText as editorInsertText, moveEnd as editorMoveEnd, moveHome as editorMoveHome, moveLeft as editorMoveLeft, moveRight as editorMoveRight, } from './input-editor.js';
function clampCursor(text, cursor) {
    return Math.max(0, Math.min(cursor, text.length));
}
function toEditorState(snapshot) {
    return {
        draft: snapshot.draft,
        cursor: snapshot.cursor,
    };
}
export function createQueuedInputState(initial) {
    let snapshot = {
        draft: initial?.draft ?? '',
        cursor: clampCursor(initial?.draft ?? '', initial?.cursor ?? (initial?.draft ?? '').length),
        queued: initial?.queued ?? null,
        editingQueued: initial?.editingQueued ?? false,
    };
    const updateDraft = (draft, cursor = snapshot.cursor, editingQueued = snapshot.editingQueued) => {
        snapshot = {
            ...snapshot,
            draft,
            cursor: clampCursor(draft, cursor),
            editingQueued,
        };
    };
    const insertText = (text) => {
        if (!text)
            return;
        const next = editorInsertText(toEditorState(snapshot), text);
        updateDraft(next.draft, next.cursor);
    };
    const editQueued = () => {
        if (!snapshot.queued) {
            return { type: 'none' };
        }
        const value = snapshot.queued.text;
        snapshot = {
            draft: value,
            cursor: value.length,
            queued: null,
            editingQueued: true,
        };
        return { type: 'edit', value };
    };
    return {
        getSnapshot() {
            return {
                draft: snapshot.draft,
                cursor: snapshot.cursor,
                queued: snapshot.queued ? { ...snapshot.queued } : null,
                editingQueued: snapshot.editingQueued,
            };
        },
        insertText,
        setDraft(text, cursor = text.length) {
            updateDraft(text, cursor, false);
        },
        moveLeft() {
            const next = editorMoveLeft(toEditorState(snapshot));
            updateDraft(next.draft, next.cursor);
        },
        moveRight() {
            const next = editorMoveRight(toEditorState(snapshot));
            updateDraft(next.draft, next.cursor);
        },
        moveHome() {
            const next = editorMoveHome(toEditorState(snapshot));
            updateDraft(next.draft, next.cursor);
        },
        moveEnd() {
            const next = editorMoveEnd(toEditorState(snapshot));
            updateDraft(next.draft, next.cursor);
        },
        backspace() {
            const next = editorBackspace(toEditorState(snapshot));
            updateDraft(next.draft, next.cursor);
        },
        deleteToStart() {
            const next = editorDeleteToStart(toEditorState(snapshot));
            updateDraft(next.draft, next.cursor);
        },
        insertNewline() {
            const next = editorInsertNewline(toEditorState(snapshot));
            updateDraft(next.draft, next.cursor);
        },
        submitDraft(now = Date.now()) {
            if (snapshot.draft.length === 0) {
                return { type: 'none' };
            }
            const text = snapshot.draft;
            const previous = snapshot.queued;
            snapshot = {
                draft: '',
                cursor: 0,
                queued: { text, queuedAt: now },
                editingQueued: false,
            };
            if (previous) {
                return { type: 'replace', oldValue: previous.text, newValue: text };
            }
            return { type: 'submit', value: text };
        },
        editQueued,
        handleEscape() {
            if (snapshot.draft.length > 0) {
                const value = snapshot.draft;
                updateDraft('', 0, false);
                return { type: 'clear-draft', value };
            }
            return editQueued();
        },
        consumeQueued() {
            const value = snapshot.queued?.text ?? null;
            snapshot = {
                ...snapshot,
                queued: null,
            };
            return value;
        },
    };
}
