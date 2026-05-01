/**
 * Interactive question prompt — CC-style AskUserQuestion for the terminal.
 *
 * Renders:
 *   - Header chip + question text
 *   - Numbered option list with ❯ highlight (left column)
 *   - Optional preview panel (right column, shown when focused option has preview)
 *   - Multi-select support (Space to toggle, Enter to confirm)
 *   - "Other" free-text input option always appended
 *
 * Usage:
 *   const answer = await askQuestion({
 *     header: 'Auth method',
 *     question: 'Which auth method?',
 *     options: [
 *       { label: 'JWT', description: 'Stateless tokens', preview: '```ts\njwt.sign()\n```' },
 *       { label: 'Session', description: 'Server-side sessions' },
 *     ],
 *     multiSelect: false,
 *   });
 */

import { createInterface } from 'node:readline';
import { boldCyan, dim, bold, cyan } from './render.js';
import { getDisplayWidth } from './display-width.js';
import { MarkdownRenderer } from './markdown.js';
import { sliceByDisplayColumns, stripAnsi } from './text-metrics.js';

export interface AskOption {
  label: string;
  description?: string;
  preview?: string;
}

export interface AskQuestionParams {
  header?: string;
  question: string;
  options: AskOption[];
  multiSelect?: boolean;
}

export interface AskQuestionResult {
  selected: number[];       // indices into options (not including "Other")
  labels: string[];         // label strings of selected options
  otherText?: string;       // filled if user chose "Other"
}

// ─── ANSI helpers ────────────────────────────────────────────────────────────

const RESET   = '\x1b[0m';
const BG_SEL  = '\x1b[48;5;238m';   // selected row background
const FG_DIM  = '\x1b[2m';
const FG_BOLD_CYAN = '\x1b[1;36m';
const FG_RESET = '\x1b[22;39m';

function chip(text: string): string {
  return `\x1b[48;5;238m\x1b[1;37m □ ${text} ${RESET}`;
}

function truncatePlainLine(text: string, width: number): string {
  if (getDisplayWidth(text) <= width) {
    return text;
  }
  return `${sliceByDisplayColumns(text, 0, Math.max(0, width - 1))}…`;
}

// ─── Renderer ────────────────────────────────────────────────────────────────

function renderFrame(
  params: AskQuestionParams,
  selectedIdx: number,
  checked: Set<number>,
  cols: number,
): string[] {
  const allOptions: AskOption[] = [...params.options, { label: 'Other', description: 'Enter custom text' }];
  const hasPreview = allOptions.some((o) => o.preview);
  const leftWidth = hasPreview ? Math.floor(cols * 0.45) : cols - 2;
  const rightWidth = hasPreview ? cols - leftWidth - 3 : 0;

  const lines: string[] = [];

  // Header chip
  if (params.header) {
    lines.push(chip(params.header));
    lines.push('');
  }

  // Question
  lines.push(bold(params.question));

  // If has preview, add boxTop as a separate line above options
  if (hasPreview) {
    const innerWidth = rightWidth - 2;
    const boxTop = `┌${'─'.repeat(innerWidth)}┐`;
    lines.push(' '.repeat(leftWidth + 3) + dim(boxTop));
  }

  // Build option lines and preview content lines
  const innerWidth = rightWidth - 2;
  const previewText = hasPreview ? (allOptions[selectedIdx]?.preview ?? '') : '';
  const previewLines = previewText
    ? MarkdownRenderer.renderToLines(previewText).filter((l) => l !== '')
    : [];

  for (let i = 0; i < allOptions.length; i++) {
    const opt = allOptions[i];
    const isSelected = i === selectedIdx;
    const isChecked = checked.has(i);
    const prefix = isSelected ? `${FG_BOLD_CYAN}❯${FG_RESET}` : ' ';
    const num = dim(`${i + 1}.`);
    const checkMark = params.multiSelect ? (isChecked ? `${FG_BOLD_CYAN}✓${FG_RESET} ` : '  ') : '';
    const labelStr = isSelected ? `${FG_BOLD_CYAN}${opt.label}${RESET}` : opt.label;
    const descStr = opt.description ? `  ${FG_DIM}${opt.description}${RESET}` : '';
    const checkText = params.multiSelect ? (isChecked ? '✓ ' : '  ') : '';
    const plainLeftContent = `  ${isSelected ? '❯' : ' '} ${i + 1}. ${checkText}${opt.label}${opt.description ? `  ${opt.description}` : ''}`;

    // Left side: option
    let leftContent = `  ${prefix} ${num} ${checkMark}${labelStr}${descStr}`;
    const leftVisible = `  ${isSelected ? '❯' : ' '} ${i + 1}. ${checkMark.replace(/\x1b\[[^m]*m/g, '')}${opt.label}${opt.description ? '  ' + opt.description : ''}`;
    const leftPad = Math.max(0, leftWidth - getDisplayWidth(leftVisible));

    if (isSelected && hasPreview) {
      leftContent = `${BG_SEL}${leftContent}${' '.repeat(leftPad)}${RESET}`;
    } else {
      leftContent = leftContent + ' '.repeat(leftPad);
    }

    if (!hasPreview) {
      lines.push(truncatePlainLine(plainLeftContent, leftWidth));
    } else {
      // Right side: preview content (or empty)
      const pl = previewLines[i] ?? '';
      const visibleWidth = getDisplayWidth(stripAnsi(pl));
      let rightContent = pl;
      if (visibleWidth > innerWidth) {
        // Truncate
        let w = 0;
        let cut = 0;
        for (const ch of stripAnsi(pl)) {
          const cw = getDisplayWidth(ch);
          if (w + cw > innerWidth - 1) break;
          w += cw;
          cut++;
        }
        rightContent = stripAnsi(pl).slice(0, cut) + dim('…');
      }
      const rightPad = Math.max(0, innerWidth - getDisplayWidth(stripAnsi(rightContent)));
      lines.push(`${leftContent}   ${dim('│')}${rightContent}${' '.repeat(rightPad)}${dim('│')}`);
    }
  }

  // If has preview, add boxBottom as a separate line below options
  if (hasPreview) {
    const boxBottom = `└${'─'.repeat(innerWidth)}┘`;
    lines.push(' '.repeat(leftWidth + 3) + dim(boxBottom));
  }

  // Footer hint
  if (params.multiSelect) {
    lines.push(dim('  ↑↓ navigate   Space select   Enter confirm'));
  } else {
    lines.push(dim('  ↑↓ navigate   Enter select'));
  }

  return lines;
}

function countRenderedTerminalRows(lines: string[], cols: number): number {
  const safeCols = Math.max(1, cols);
  return lines.reduce((total, line) => (
    total + Math.max(1, Math.ceil(getDisplayWidth(stripAnsi(line)) / safeCols))
  ), 0);
}

// ─── Main function ────────────────────────────────────────────────────────────

export async function askQuestion(params: AskQuestionParams): Promise<AskQuestionResult> {
  const allOptions: AskOption[] = [...params.options, { label: 'Other', description: 'Enter custom text' }];
  const otherIdx = allOptions.length - 1;

  return new Promise((resolve) => {
    const stdout = process.stdout;
    const cols = stdout.columns ?? 80;
    let selectedIdx = 0;
    const checked = new Set<number>();
    let renderedRowCount = 0;

    // Switch to raw mode
    const rl = createInterface({ input: process.stdin });
    process.stdin.setRawMode?.(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    function clearFrame() {
      if (renderedRowCount > 0) {
        if (renderedRowCount > 1) {
          stdout.write(`\x1b[${renderedRowCount - 1}A`);
        }
        stdout.write('\r');
        for (let i = 0; i < renderedRowCount; i++) {
          stdout.write('\x1b[2K');
          if (i < renderedRowCount - 1) {
            stdout.write('\x1b[1B\r');
          }
        }
        if (renderedRowCount > 1) {
          stdout.write(`\x1b[${renderedRowCount - 1}A`);
        }
        stdout.write('\r');
      }
    }

    function draw() {
      clearFrame();
      const terminalCols = stdout.columns ?? cols;
      const frameLines = renderFrame(params, selectedIdx, checked, terminalCols);
      renderedRowCount = countRenderedTerminalRows(frameLines, terminalCols);
      // Write lines without trailing newline — cursor stays on last line
      stdout.write(frameLines.join('\n'));
    }

    async function confirmSelection() {
      // Clean up
      process.stdin.setRawMode?.(false);
      process.stdin.pause();
      process.stdin.removeListener('data', onKey);
      rl.close();
      clearFrame();

      if (selectedIdx === otherIdx) {
        // "Other" — prompt for free text
        stdout.write(`${boldCyan('❯')} ${bold(params.question)}\n`);
        stdout.write(`${dim('Enter your answer:')} `);

        // Use a fresh readline with resumed stdin
        process.stdin.resume();
        const text = await new Promise<string>((res) => {
          const rl2 = createInterface({ input: process.stdin, output: stdout });
          rl2.question('', (ans) => {
            rl2.close();
            res(ans);
          });
        });
        stdout.write('\n');
        resolve({ selected: [], labels: [], otherText: text });
      } else {
        const finalSelected = params.multiSelect
          ? [...checked].filter((i) => i !== otherIdx)
          : [selectedIdx];
        const labels = finalSelected.map((i) => allOptions[i]!.label);
        // Print confirmation
        stdout.write(`${boldCyan('❯')} ${bold(params.question)}\n`);
        for (const label of labels) {
          stdout.write(`  ${dim('·')} ${cyan(label)}\n`);
        }
        stdout.write('\n');
        resolve({ selected: finalSelected, labels });
      }
    }

    function onKey(key: string) {
      const UP    = '\x1b[A';
      const DOWN  = '\x1b[B';
      const ENTER = '\r';
      const SPACE = ' ';
      const CTRL_C = '\x03';
      const ESC   = '\x1b';

      if (key === CTRL_C || key === ESC) {
        process.stdin.setRawMode?.(false);
        process.stdin.removeListener('data', onKey);
        rl.close();
        clearFrame();
        // Return empty result (cancelled)
        resolve({ selected: [], labels: [] });
        return;
      }

      if (key === UP) {
        selectedIdx = (selectedIdx - 1 + allOptions.length) % allOptions.length;
        draw();
      } else if (key === DOWN) {
        selectedIdx = (selectedIdx + 1) % allOptions.length;
        draw();
      } else if (key === SPACE && params.multiSelect) {
        if (checked.has(selectedIdx)) checked.delete(selectedIdx);
        else checked.add(selectedIdx);
        draw();
      } else if (key === ENTER) {
        if (params.multiSelect && checked.size === 0) {
          // Nothing checked — treat current selection as the answer
          checked.add(selectedIdx);
        }
        void confirmSelection();
      }
    }

    process.stdin.on('data', onKey);
    draw();
  });
}
