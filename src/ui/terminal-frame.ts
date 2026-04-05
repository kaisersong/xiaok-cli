import { formatPermissionPromptLines } from './permission-prompt.js';
import { buildSlashMenuOverlayLines } from './repl-state.js';
import { getDisplayWidth, offsetToDisplayColumn } from './text-metrics.js';
import type { SurfaceState } from './surface-state.js';

// Input bar: bg=238 (visible above terminal bg ~235), prompt=bold cyan, reset with \x1b[0m at end
// We build the line as: BG_START + PROMPT_FG + '❯' + RESET_FG + ' ' + inputText + padding + BG_END
// Using \x1b[39m (reset fg only) after ❯ so background persists through the rest of the line.
const INPUT_BG = '\x1b[48;5;238m';
const PROMPT_FG = '\x1b[1;36m';   // bold cyan
const RESET_FG  = '\x1b[22;39m';  // reset bold + fg, keep bg
const RESET_ALL = '\x1b[0m';

export interface TerminalFrame {
  lines: string[];
  cursor: {
    line: number;
    column: number;
  } | null;
}

function buildModalLines(state: SurfaceState): string[] {
  if (state.modal?.type !== 'permission') return [];
  const modal = state.modal;

  const formattedLines = formatPermissionPromptLines(
    modal.toolName,
    {},
    modal.options.map((option, index) => ({
      label: option,
      selected: index === modal.selectedIndex,
    })),
  );

  return formattedLines.slice(0, 2).concat(modal.targetLines, formattedLines.slice(2));
}

function buildOverlayLines(state: SurfaceState): string[] {
  if (!state.overlay) return [];

  if (state.overlay.type === 'lines') {
    return state.overlay.lines;
  }

  return buildSlashMenuOverlayLines(
    state.overlay.items,
    state.overlay.selectedIndex,
    state.terminalSize.columns,
    8,
  );
}

export function buildTerminalFrame(state: SurfaceState): TerminalFrame {
  const modalLines = buildModalLines(state);
  const cols = state.terminalSize.columns ?? 80;

  // Strip leading '> ' from prompt if present
  const rawPrompt = state.prompt.replace(/^>\s/, '');
  const inputText = rawPrompt + state.input.value;
  const visibleWidth = getDisplayWidth('❯ ' + inputText);
  const padCount = Math.max(0, cols - visibleWidth);

  // Build prompt line with persistent background:
  // BG stays active across the whole line because we only reset fg, not bg, after ❯
  const promptLine = `${INPUT_BG}${PROMPT_FG}❯${RESET_FG} ${inputText}${' '.repeat(padCount)}${RESET_ALL}`;

  const overlayLines = buildOverlayLines(state);
  const shouldHideFooter = modalLines.length > 0 || overlayLines.length > 0;
  const footerLines = shouldHideFooter ? [] : (state.footerLines ?? []);
  const lines = [promptLine, ...footerLines, ...(modalLines.length > 0 ? modalLines : overlayLines)];

  const promptLineIndex = 0;
  // Cursor column = width of '❯ ' + width of rawPrompt + cursor offset into input value
  const cursorColumn = getDisplayWidth('❯ ' + rawPrompt) + offsetToDisplayColumn(state.input.value, state.input.cursorOffset);

  return {
    lines,
    cursor: state.focusTarget === 'input'
      ? { line: promptLineIndex, column: cursorColumn }
      : null,
  };
}
