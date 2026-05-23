export interface InputEditorState {
  draft: string;
  cursor: number;
}

function clampCursor(draft: string, cursor: number): number {
  return Math.max(0, Math.min(cursor, draft.length));
}

function withCursor(state: InputEditorState, cursor: number): InputEditorState {
  return {
    draft: state.draft,
    cursor: clampCursor(state.draft, cursor),
  };
}

export function insertText(state: InputEditorState, text: string): InputEditorState {
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

export function backspace(state: InputEditorState): InputEditorState {
  const cursor = clampCursor(state.draft, state.cursor);
  if (cursor <= 0) {
    return { draft: state.draft, cursor };
  }
  return {
    draft: state.draft.slice(0, cursor - 1) + state.draft.slice(cursor),
    cursor: cursor - 1,
  };
}

export function deleteToStart(state: InputEditorState): InputEditorState {
  const cursor = clampCursor(state.draft, state.cursor);
  if (cursor <= 0) {
    return { draft: state.draft, cursor };
  }
  return {
    draft: state.draft.slice(cursor),
    cursor: 0,
  };
}

export function deleteToEnd(state: InputEditorState): InputEditorState {
  const cursor = clampCursor(state.draft, state.cursor);
  if (cursor >= state.draft.length) {
    return { draft: state.draft, cursor };
  }
  return {
    draft: state.draft.slice(0, cursor),
    cursor,
  };
}

export function insertNewline(state: InputEditorState): InputEditorState {
  return insertText(state, '\n');
}

export function moveLeft(state: InputEditorState): InputEditorState {
  return withCursor(state, state.cursor - 1);
}

export function moveRight(state: InputEditorState): InputEditorState {
  return withCursor(state, state.cursor + 1);
}

export function moveHome(state: InputEditorState): InputEditorState {
  return withCursor(state, 0);
}

export function moveEnd(state: InputEditorState): InputEditorState {
  return withCursor(state, state.draft.length);
}
