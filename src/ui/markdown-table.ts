import { getDisplayWidth, stripAnsi } from './text-metrics.js';

export type TableAlignment = 'left' | 'right' | 'center';
export interface MarkdownTable {
  header: string[];
  alignment: TableAlignment[];
  rows: string[][];
}

/** Split only structural pipes; matched code spans and escaped pipes are data. */
export function splitTableRow(line: string): string[] | null {
  const text = line.trim();
  const cells: string[] = [];
  let cell = '';
  let pipes = 0;
  let leading = false;
  let trailing = false;
  for (let i = 0; i < text.length;) {
    if (text[i] === '\\' && i + 1 < text.length) {
      cell += text[i + 1] === '|' ? '|' : text.slice(i, i + 2);
      i += 2; trailing = false; continue;
    }
    if (text[i] === '`') {
      const fence = text.slice(i).match(/^`+/)![0];
      let end = i + fence.length;
      let closing = -1;
      while (end < text.length) {
        const at = text.indexOf('`', end);
        if (at < 0) break;
        const run = text.slice(at).match(/^`+/)![0];
        if (run.length === fence.length) { closing = at + run.length; break; }
        end = at + run.length;
      }
      if (closing >= 0) { cell += text.slice(i, closing); i = closing; trailing = false; continue; }
      cell += fence; i += fence.length; trailing = false; continue;
    }
    if (text[i] === '|') {
      if (i === 0) leading = true;
      pipes++; cells.push(cell.trim()); cell = ''; trailing = i === text.length - 1;
    } else { cell += text[i]; trailing = false; }
    i++;
  }
  if (!pipes) return null;
  cells.push(cell.trim());
  if (leading) cells.shift();
  if (trailing) cells.pop();
  return cells.length ? cells : null;
}

export function tableAlignment(line: string, columns: number): TableAlignment[] | null {
  const cells = splitTableRow(line);
  if (!cells || cells.length !== columns || cells.some(cell => !/^:?-{3,}:?$/.test(cell))) return null;
  return cells.map(cell => cell.endsWith(':') ? cell.startsWith(':') ? 'center' : 'right' : 'left');
}

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
function graphemeWidth(text: string): number {
  if (/[\p{Extended_Pictographic}\p{Regional_Indicator}\u20e3]/u.test(text)) return 2;
  return getDisplayWidth(text.replace(/[\p{Mark}\u200d\ufe0e\ufe0f]/gu, ''));
}
export function tableDisplayWidth(text: string): number {
  return [...segmenter.segment(stripAnsi(text))].reduce((sum, part) => sum + graphemeWidth(part.segment), 0);
}

/** Preserve SGR across cell wraps, but reset before separators and adjacent cells. */
function wrapCell(text: string, width: number): string[] {
  const lines: string[] = [];
  let current = '', active = '', size = 0;
  for (const token of text.split(/(\x1b\[[0-9;]*m)/g)) {
    if (/^\x1b\[[0-9;]*m$/.test(token)) {
      active = token === '\x1b[0m' ? '' : active + token;
      current += token; continue;
    }
    for (const { segment } of segmenter.segment(token.replace(/\t/g, ' '))) {
      const cells = graphemeWidth(segment);
      if (size > 0 && size + cells > width) {
        lines.push(current + (active ? '\x1b[0m' : ''));
        current = active; size = 0;
      }
      current += segment; size += cells;
    }
  }
  lines.push(current + (active ? '\x1b[0m' : ''));
  return lines;
}

export function renderMarkdownTable(
  table: MarkdownTable,
  columns: number,
  inline: (text: string) => string,
  forceRecords = false,
): string[] {
  const available = Math.max(2, columns - 1);
  const prefix = available >= 8 ? '  ' : '';
  const width = available - prefix.length;
  const header = table.header.map(inline);
  const rows = table.rows.map(row => row.map(inline));
  const count = header.length;
  const space = width - (count * 3 + 1);
  if (forceRecords || space < count * 6) {
    const records = rows.length ? rows : [header.map(() => '')];
    return records.flatMap((row, index) => [
      ...(index ? [''] : []),
      ...row.flatMap((cell, column) => wrapCell(`${header[column]}: ${cell}`, width).map(line => prefix + line)),
    ]);
  }
  const widths = header.map((cell, i) => Math.max(1, tableDisplayWidth(cell), ...rows.map(row => tableDisplayWidth(row[i]))));
  while (widths.reduce((sum, value) => sum + value, 0) > space) {
    const largest = Math.max(...widths);
    widths[widths.indexOf(largest)]--;
  }
  const rowLines = (row: string[]) => {
    const cells = row.map((cell, i) => wrapCell(cell, widths[i]));
    return Array.from({ length: Math.max(...cells.map(cell => cell.length)) }, (_, line) => {
      const values = cells.map((cell, i) => {
        const text = cell[line] ?? '';
        const padding = Math.max(0, widths[i] - tableDisplayWidth(text));
        const left = table.alignment[i] === 'right' ? padding : table.alignment[i] === 'center' ? Math.floor(padding / 2) : 0;
        return ' '.repeat(left) + text + ' '.repeat(padding - left);
      });
      return `${prefix}│ ${values.join(' │ ')} │`;
    });
  };
  return [
    ...rowLines(header),
    prefix + '├' + widths.map(width => '─'.repeat(width + 2)).join('┼') + '┤',
    ...rows.flatMap(rowLines),
  ];
}
