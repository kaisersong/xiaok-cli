function clampCursor(draft, cursor) {
    return Math.max(0, Math.min(cursor, draft.length));
}
function withCursor(state, cursor) {
    return {
        draft: state.draft,
        cursor: clampCursor(state.draft, cursor),
    };
}
export function insertText(state, text) {
    if (!text) {
        return withCursor(state, state.cursor);
    }
    const cursor = clampCursor(state.draft, state.cursor);
    const draft = state.draft.slice(0, cursor) + text + state.draft.slice(cursor);
    return {
        draft,
        cursor: cursor + text.length,
    };
}
export function backspace(state) {
    const cursor = clampCursor(state.draft, state.cursor);
    if (cursor <= 0) {
        return { draft: state.draft, cursor };
    }
    return {
        draft: state.draft.slice(0, cursor - 1) + state.draft.slice(cursor),
        cursor: cursor - 1,
    };
}
export function deleteToStart(state) {
    const cursor = clampCursor(state.draft, state.cursor);
    if (cursor <= 0) {
        return { draft: state.draft, cursor };
    }
    return {
        draft: state.draft.slice(cursor),
        cursor: 0,
    };
}
export function deleteToEnd(state) {
    const cursor = clampCursor(state.draft, state.cursor);
    if (cursor >= state.draft.length) {
        return { draft: state.draft, cursor };
    }
    return {
        draft: state.draft.slice(0, cursor),
        cursor,
    };
}
export function insertNewline(state) {
    return insertText(state, '\n');
}
export function moveLeft(state) {
    return withCursor(state, state.cursor - 1);
}
export function moveRight(state) {
    return withCursor(state, state.cursor + 1);
}
export function moveHome(state) {
    return withCursor(state, 0);
}
export function moveEnd(state) {
    return withCursor(state, state.draft.length);
}
