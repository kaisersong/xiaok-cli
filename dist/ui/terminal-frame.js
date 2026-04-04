import { formatPermissionPromptLines } from './permission-prompt.js';
import { buildSlashMenuOverlayLines } from './repl-state.js';
import { getDisplayWidth, offsetToDisplayColumn } from './text-metrics.js';
function buildModalLines(state) {
    if (state.modal?.type !== 'permission')
        return [];
    const modal = state.modal;
    const formattedLines = formatPermissionPromptLines(modal.toolName, {}, modal.options.map((option, index) => ({
        label: option,
        selected: index === modal.selectedIndex,
    })));
    return formattedLines.slice(0, 2).concat(modal.targetLines, formattedLines.slice(2));
}
function buildOverlayLines(state) {
    if (!state.overlay)
        return [];
    if (state.overlay.type === 'lines') {
        return state.overlay.lines;
    }
    return buildSlashMenuOverlayLines(state.overlay.items, state.overlay.selectedIndex, state.terminalSize.columns, 8);
}
export function buildTerminalFrame(state) {
    const modalLines = buildModalLines(state);
    const promptLine = `${state.prompt}${state.input.value}`;
    const overlayLines = buildOverlayLines(state);
    const shouldHideFooter = modalLines.length > 0 || overlayLines.length > 0;
    const footerLines = shouldHideFooter ? [] : (state.footerLines ?? []);
    const lines = [promptLine, ...footerLines, ...(modalLines.length > 0 ? modalLines : overlayLines)];
    const promptLineIndex = 0;
    const cursorColumn = getDisplayWidth(state.prompt) + offsetToDisplayColumn(state.input.value, state.input.cursorOffset);
    return {
        lines,
        cursor: state.focusTarget === 'input'
            ? { line: promptLineIndex, column: cursorColumn }
            : null,
    };
}
