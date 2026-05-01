import { formatPermissionPromptLines } from './permission-prompt.js';
import { buildSlashMenuOverlayLines } from './repl-state.js';
import { getDisplayWidth, offsetToDisplayColumn } from './text-metrics.js';
import type { SurfaceState } from './surface-state.js';

// Input bar: bg=244 (visible above most dark terminal backgrounds)
// We build the line as: BG_START + PROMPT_FG + '❯' + RESET_FG + ' ' + inputText + padding + BG_END
// Using \x1b[39m (reset fg only) after ❯ so background persists through the rest of the line.
const INPUT_BG = '\x1b[48;5;244m';
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
  const inputLines = (rawPrompt + state.input.value).split('\n');

  // Build each input line with persistent background
  const promptLines = inputLines.map((lineText, lineIndex) => {
    const prefix = lineIndex === 0 ? `${PROMPT_FG}❯${RESET_FG} ` : '  '; // First line has ❯, others just spaces
    const visibleWidth = getDisplayWidth(prefix + lineText);
    const padCount = Math.max(0, cols - visibleWidth);
    return `${INPUT_BG}${prefix}${lineText}${' '.repeat(padCount)}${RESET_ALL}`;
  });

  const overlayLines = buildOverlayLines(state);
  const shouldHideFooter = modalLines.length > 0 || overlayLines.length > 0;
  const footerLines = shouldHideFooter ? [] : (state.footerLines ?? []);
  const hasSummaryLine = footerLines.length > 1 && (footerLines[0] ?? '').trim().length > 0;
  const summaryLines = hasSummaryLine ? [footerLines[0] ?? '', '', ''] : [];
  const statusLines = footerLines.length > 1 ? footerLines.slice(1) : footerLines;
  const promptLineOffset = summaryLines.length;
  const lines = [
    ...summaryLines,
    ...promptLines,
    ...statusLines,
    ...(modalLines.length > 0 ? modalLines : overlayLines),
  ];

  // Calculate cursor position across multi-line input
  const cursorLineIndex = Math.min(
    rawPrompt.split('\n').length - 1 + state.input.value.slice(0, state.input.cursorOffset).split('\n').length - 1,
    promptLines.length - 1
  );
  const textBeforeCursorOnLine = state.input.value.slice(0, state.input.cursorOffset).split('\n').pop() || '';
  const prefixWidth = cursorLineIndex === 0 ? getDisplayWidth('❯ ' + rawPrompt.split('\n')[0]) : getDisplayWidth('  ');
  const cursorColumn = prefixWidth + getDisplayWidth(textBeforeCursorOnLine);

  return {
    lines,
    cursor: state.focusTarget === 'input'
      ? { line: promptLineOffset + cursorLineIndex, column: cursorColumn }
      : null,
  };
}
