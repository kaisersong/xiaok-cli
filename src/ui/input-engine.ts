import { identifyKey, resolveAction, type Action } from './keybindings.js';
import type { InputPasteController } from './input-paste.js';
import {
  backspace,
  deleteToEnd,
  deleteToStart,
  insertNewline,
  insertText,
  moveEnd,
  moveHome,
  moveLeft,
  moveRight,
} from './input-editor.js';

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

export function normalizeBatchedInput(raw: string): string {
  return raw
    .replace(/\r[ \t]*(?:›|❯)\s*/gu, '')
    .replace(/\r\n/gu, '\n')
    .replace(/\r(?!$)/gu, '\n');
}

function clampCursor(draft: string, cursor: number): number {
  return Math.max(0, Math.min(cursor, draft.length));
}

function normalizeSnapshot(snapshot: Partial<InputEngineSnapshot>): InputEngineSnapshot {
  const draft = snapshot.draft ?? '';
  return {
    draft,
    cursor: clampCursor(draft, snapshot.cursor ?? draft.length),
  };
}

export function createInputEngine(options: InputEngineOptions): InputEngine {
  let snapshot = normalizeSnapshot(options.initialSnapshot ?? {});

  const setSnapshot = (next: Partial<InputEngineSnapshot>) => {
    snapshot = normalizeSnapshot({
      draft: next.draft ?? snapshot.draft,
      cursor: next.cursor ?? snapshot.cursor,
    });
  };

  const publish = (next: InputEngineSnapshot, reason: InputEngineChangeReason) => {
    snapshot = normalizeSnapshot(next);
    options.policy.onChange({ ...snapshot }, reason);
  };

  const publishPolicySnapshot = (next: InputEngineSnapshot | void) => {
    if (!next) return;
    publish(next, 'policy');
  };

  const applyEdit = (next: InputEngineSnapshot) => {
    publish(next, 'edit');
  };

  const applyMove = (next: InputEngineSnapshot) => {
    publish(next, 'move');
  };

  const handleAction = (action: Action): boolean => {
    if (action === 'submit') {
      publishPolicySnapshot(options.policy.onSubmit(snapshot.draft));
      return true;
    }
    if (action === 'cancel' || action === 'escape') {
      publishPolicySnapshot(options.policy.onCancel());
      return true;
    }
    if (action === 'eof') {
      if (snapshot.draft.length === 0) {
        publishPolicySnapshot(options.policy.onCancel());
      }
      return true;
    }
    if (action === 'newline') {
      applyEdit(insertNewline(snapshot));
      return true;
    }
    if (action === 'delete-back') {
      applyEdit(backspace(snapshot));
      return true;
    }
    if (action === 'delete-to-start') {
      applyEdit(deleteToStart(snapshot));
      return true;
    }
    if (action === 'delete-to-end') {
      applyEdit(deleteToEnd(snapshot));
      return true;
    }
    if (action === 'cursor-left' || action === 'word-left') {
      applyMove(moveLeft(snapshot));
      return true;
    }
    if (action === 'cursor-right' || action === 'word-right') {
      applyMove(moveRight(snapshot));
      return true;
    }
    if (action === 'cursor-home') {
      applyMove(moveHome(snapshot));
      return true;
    }
    if (action === 'cursor-end') {
      applyMove(moveEnd(snapshot));
      return true;
    }
    if (action === 'paste-image') {
      const placeholder = options.pasteController.importClipboardImage();
      if (placeholder) {
        applyEdit(insertText(snapshot, placeholder));
      }
      return true;
    }
    if (action === 'tab' && options.policy.allowSlashMenu === false) {
      return false;
    }

    const unhandled = options.policy.onUnhandledAction?.(action, { ...snapshot });
    if (typeof unhandled === 'object') {
      publish(unhandled, 'policy');
      return true;
    }
    return Boolean(unhandled);
  };

  const handleChunk = (raw: string): boolean => {
    const pasteResult = options.pasteController.handleChunk(raw);
    if (pasteResult.placeholder) {
      applyEdit(insertText(snapshot, pasteResult.placeholder));
    }
    if (pasteResult.handled) {
      return true;
    }

    const normalizedBatch = raw.length > 1 ? normalizeBatchedInput(raw) : raw;
    let handledAny = false;
    let i = 0;
    while (i < normalizedBatch.length) {
      const identified = identifyKey(normalizedBatch, i);
      if (identified && identified.consumed > 0) {
        const action = resolveAction(identified.key);
        if (!action || !handleAction(action)) {
          return handledAny;
        }
        handledAny = true;
        i += identified.consumed;
        continue;
      }

      const ch = normalizedBatch[i] ?? '';
      if (ch >= ' ' && !/[\x1b\x7f]/.test(ch)) {
        applyEdit(insertText(snapshot, ch));
        handledAny = true;
      }
      i += 1;
    }
    return handledAny;
  };

  return {
    handleChunk,
    handleAction,
    getSnapshot() {
      return { ...snapshot };
    },
    setSnapshot,
  };
}
