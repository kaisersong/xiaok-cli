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

export type QueuedInputMutation =
  | { type: 'none' }
  | { type: 'submit'; value: string }
  | { type: 'replace'; oldValue: string; newValue: string }
  | { type: 'edit'; value: string }
  | { type: 'clear-draft'; value: string };

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

function clampCursor(text: string, cursor: number): number {
  return Math.max(0, Math.min(cursor, text.length));
}

export function createQueuedInputState(initial?: Partial<QueuedInputSnapshot>): QueuedInputState {
  let snapshot: QueuedInputSnapshot = {
    draft: initial?.draft ?? '',
    cursor: clampCursor(initial?.draft ?? '', initial?.cursor ?? (initial?.draft ?? '').length),
    queued: initial?.queued ?? null,
    editingQueued: initial?.editingQueued ?? false,
  };

  const updateDraft = (draft: string, cursor = snapshot.cursor, editingQueued = snapshot.editingQueued) => {
    snapshot = {
      ...snapshot,
      draft,
      cursor: clampCursor(draft, cursor),
      editingQueued,
    };
  };

  const insertText = (text: string) => {
    if (!text) return;
    const draft = snapshot.draft.slice(0, snapshot.cursor) + text + snapshot.draft.slice(snapshot.cursor);
    updateDraft(draft, snapshot.cursor + text.length);
  };

  const editQueued = (): QueuedInputMutation => {
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
      updateDraft(snapshot.draft, snapshot.cursor - 1);
    },

    moveRight() {
      updateDraft(snapshot.draft, snapshot.cursor + 1);
    },

    moveHome() {
      updateDraft(snapshot.draft, 0);
    },

    moveEnd() {
      updateDraft(snapshot.draft, snapshot.draft.length);
    },

    backspace() {
      if (snapshot.cursor <= 0) return;
      const draft = snapshot.draft.slice(0, snapshot.cursor - 1) + snapshot.draft.slice(snapshot.cursor);
      updateDraft(draft, snapshot.cursor - 1);
    },

    deleteToStart() {
      if (snapshot.cursor <= 0) return;
      updateDraft(snapshot.draft.slice(snapshot.cursor), 0);
    },

    insertNewline() {
      insertText('\n');
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
