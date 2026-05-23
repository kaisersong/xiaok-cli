import { identifyKey, resolveAction } from './keybindings.js';
import { backspace, deleteToEnd, deleteToStart, insertNewline, insertText, moveEnd, moveHome, moveLeft, moveRight, } from './input-editor.js';
export function normalizeBatchedInput(raw) {
    return raw
        .replace(/\r[ \t]*(?:›|❯)\s*/gu, '')
        .replace(/\r\n/gu, '\n')
        .replace(/\r(?!$)/gu, '\n');
}
function clampCursor(draft, cursor) {
    return Math.max(0, Math.min(cursor, draft.length));
}
function normalizeSnapshot(snapshot) {
    const draft = snapshot.draft ?? '';
    return {
        draft,
        cursor: clampCursor(draft, snapshot.cursor ?? draft.length),
    };
}
export function createInputEngine(options) {
    let snapshot = normalizeSnapshot(options.initialSnapshot ?? {});
    const setSnapshot = (next) => {
        snapshot = normalizeSnapshot({
            draft: next.draft ?? snapshot.draft,
            cursor: next.cursor ?? snapshot.cursor,
        });
    };
    const publish = (next, reason) => {
        snapshot = normalizeSnapshot(next);
        options.policy.onChange({ ...snapshot }, reason);
    };
    const publishPolicySnapshot = (next) => {
        if (!next)
            return;
        publish(next, 'policy');
    };
    const applyEdit = (next) => {
        publish(next, 'edit');
    };
    const applyMove = (next) => {
        publish(next, 'move');
    };
    const handleAction = (action) => {
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
    const handleChunk = (raw) => {
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
