import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MarkdownRenderer } from '../../src/ui/markdown.js';
import { splitTableRow, tableDisplayWidth } from '../../src/ui/markdown-table.js';
import { setColorsEnabled } from '../../src/ui/render.js';
import { getDisplayWidth, stripAnsi } from '../../src/ui/text-metrics.js';

const table = '| 指标 | 现在 | 12 小时前 |\n| :--- | ---: | :---: |\n| 代码单流 | **57.5 tok/s** | 55.9 |\n| 散文 | 35.9 | 34.3 |';

describe('streamed Markdown tables', () => {
  let output = '';
  let write: typeof process.stdout.write;
  let columns: number;
  beforeEach(() => {
    write = process.stdout.write;
    columns = process.stdout.columns;
    process.stdout.columns = 100;
    process.stdout.write = ((chunk: any) => { output += chunk; return true; }) as typeof write;
    output = '';
    setColorsEnabled(false);
  });
  afterEach(() => { process.stdout.write = write; process.stdout.columns = columns; setColorsEnabled(false); });
  const render = (text: string) => { const r = new MarkdownRenderer(); r.write(text); r.flush(); return stripAnsi(output); };

  it('buffers until the table ends and aligns Chinese and numeric columns by visible width', () => {
    const r = new MarkdownRenderer();
    r.write(table + '\n');
    expect(output).toBe('');
    r.flush();
    const rows = stripAnsi(output).split('\n').filter(line => line.includes('│'));
    expect(rows).toHaveLength(3);
    const boundaries = rows.map(row => [...row.matchAll(/│/g)].map(m => getDisplayWidth(row.slice(0, m.index))));
    expect(boundaries[1]).toEqual(boundaries[0]);
    expect(boundaries[2]).toEqual(boundaries[0]);
    expect(rows[1]).toContain('57.5 tok/s');
    expect(rows[2]).toMatch(/\s+35\.9 │/);
  });

  it('produces identical output for arbitrary chunk boundaries and repeated flush is empty', () => {
    const whole = render(table);
    output = '';
    const r = new MarkdownRenderer();
    for (const ch of table) r.write(ch);
    r.flush();
    expect(stripAnsi(output)).toBe(whole);
    const before = output;
    expect(r.flush()).toEqual({ rows: 0, renderedLine: '' });
    expect(output).toBe(before);
  });

  it('recognizes escaped pipes and inline code pipes without adding columns', () => {
    const text = render('| Name | Value |\n| --- | --- |\n| a\\|b | `x|y` |');
    const row = text.split('\n').find(line => line.includes('a|b'))!;
    expect(row).toContain('x|y');
    expect(row.match(/│/g)).toHaveLength(3);
  });

  it('keeps literal pipe text and fenced code out of table layout', () => {
    const text = render('a | b\nnormal text\n```sh\n| A | B |\n| --- | --- |\n```');
    expect(text).toContain('a | b');
    expect(text).toContain('| --- | --- |');
    expect(text).not.toContain('┼');
  });

  it('wraps cells instead of wrapping an entire table row', () => {
    process.stdout.columns = 32;
    const text = render('| 项目 | 数据 |\n| --- | ---: |\n| 很长很长很长的中文项目名称 | 12345678901234567890 |');
    for (const row of text.split('\n')) expect(getDisplayWidth(row)).toBeLessThan(32);
    expect(text).toContain('│');
    expect(text.split('\n').filter(line => line.includes('│')).slice(1).map(line => line.split('│').at(-2)!.trim()).join('')).toBe('12345678901234567890');
  });

  it('uses labeled records when columns cannot fit without losing values', () => {
    process.stdout.columns = 20;
    const text = render(table);
    expect(text).toContain('指标:');
    expect(text).toContain('现在:');
    expect(text).toContain('57.5 tok/s');
    for (const row of text.split('\n')) expect(getDisplayWidth(row)).toBeLessThan(20);
  });

  it('uses width at commit time and keeps static rendering consistent', () => {
    const r = new MarkdownRenderer(); r.write(table + '\n');
    process.stdout.columns = 20; r.flush();
    const streamed = output;
    output = '';
    expect(MarkdownRenderer.renderToLines(table).join('\n')).toBe(streamed.trimEnd());
    expect(output).toBe('');
  });

  it('keeps empty and extra cells, then resumes prose after the table', () => {
    const text = render('| A | B |\n| --- | --- |\n| | yes |\n| extra | one | two |\nAfter');
    expect(text).toContain('yes');
    expect(text).toContain('two');
    expect(text).toContain('After');
  });

  it('flushes pending tables at segment boundaries and clears pending state on reset', () => {
    const r = new MarkdownRenderer(); r.write(table + '\n'); r.beginNewSegment();
    expect(output).toContain('57.5 tok/s');
    r.write('new paragraph\n'); expect(output).toContain('● new paragraph');
    r.write('| stale | draft |\n'); r.reset(); r.flush();
    expect(output).not.toContain('stale');
  });

  it('bounds table buffering and emits every row of an oversized table', () => {
    const r = new MarkdownRenderer();
    r.write('| Key | Value |\n| --- | --- |\n');
    for (let i = 0; i < 300; i++) r.write(`| item_${i} | ${i} |\n`);
    expect(output).toContain('item_0');
    r.flush(); expect(output).toContain('item_299');
  });

  it('routes every physical newline through the scroll-region callback', () => {
    const r = new MarkdownRenderer(); let newlines = 0;
    r.setNewlineCallback(() => { newlines++; output += '\n'; });
    r.write(table + '\n'); r.flush();
    expect(newlines).toBe(output.split('\n').length - 1);
    expect(r.getLineCount()).toBe(newlines);
    expect(newlines).toBe(4);
  });

  it('splits optional edges, empty cells and matching multi-backtick code spans', () => {
    expect(splitTableRow('A | B')).toEqual(['A', 'B']);
    expect(splitTableRow('| | B |')).toEqual(['', 'B']);
    expect(splitTableRow('| ``a`|b`` | c |')).toEqual(['``a`|b``', 'c']);
    expect(splitTableRow('| unmatched ` | c |')).toEqual(['unmatched `', 'c']);
    expect(splitTableRow('ordinary text')).toBeNull();
  });

  it('keeps emoji and combining graphemes intact and uses their visible widths', () => {
    process.stdout.columns = 28;
    const text = render('| A | B |\n| --- | --- |\n| 👩‍💻é👩‍💻é👩‍💻é | 🇨🇳1234567890 |');
    expect(tableDisplayWidth('👩‍💻é🇨🇳')).toBe(5);
    expect(text.match(/👩‍💻/g)).toHaveLength(3);
    expect(text.match(/é/g)).toHaveLength(3);
    for (const line of text.split('\n')) expect(tableDisplayWidth(line)).toBeLessThan(28);
  });

  it('flushes an interrupted header without treating it as a table', () => {
    expect(render('| Pending | header |')).toContain('| Pending | header |');
    expect(output).not.toContain('┼');
  });

  it('closes one table before starting another and preserves trailing prose order', () => {
    const text = render(table + '\n\n' + table.replace('代码单流', 'SECOND') + '\n\nAFTER');
    expect(text.match(/┼/g)).toHaveLength(4);
    expect(text.indexOf('SECOND')).toBeGreaterThan(text.indexOf('代码单流'));
    expect(text.indexOf('AFTER')).toBeGreaterThan(text.indexOf('SECOND'));
  });

  it('keeps ANSI styles inside wrapped cells', () => {
    process.stdout.columns = 32; setColorsEnabled(true);
    render('| A | B |\n| --- | --- |\n| **abcdefghijklmnopqrstuv** | `1234567890123456` |');
    expect(output).toContain('\x1b[');
    for (const line of stripAnsi(output).split('\n')) expect(getDisplayWidth(line)).toBeLessThan(32);
  });
});
