import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MarkdownRenderer } from '../../src/ui/markdown.js';
import { setColorsEnabled } from '../../src/ui/render.js';

describe('MarkdownRenderer', () => {
  let output = '';
  let originalWrite: typeof process.stdout.write;
  let originalColumns: number | undefined;

  beforeEach(() => {
    setColorsEnabled(false);
    output = '';
    originalWrite = process.stdout.write;
    originalColumns = process.stdout.columns;
    process.stdout.write = ((chunk: any) => {
      output += chunk;
      return true;
    }) as typeof process.stdout.write;
  });

  afterEach(() => {
    process.stdout.write = originalWrite;
    process.stdout.columns = originalColumns;
    setColorsEnabled(false);
  });

  it('adds a shared left gutter to rendered assistant lines', () => {
    const renderer = new MarkdownRenderer();

    renderer.write('第一行\n- 列表项\n');

    expect(output).toContain('● 第一行\n');
    expect(output).toContain('• 列表项\n');
  });

  it('keeps the left gutter while streaming a partial line', () => {
    const renderer = new MarkdownRenderer();

    renderer.write('streaming');

    expect(output).toBe('● streaming');
  });

  it('counts a flushed partial line as finalized rows', () => {
    const renderer = new MarkdownRenderer();

    renderer.write('streaming');
    const flushResult = renderer.flush();

    expect(flushResult.rows).toBe(1);
    expect(flushResult.renderedLine).toBe('● streaming');
    expect(renderer.getLineCount()).toBe(1);
  });

  it('wraps the first paragraph with a hanging indent instead of repeating the bullet', () => {
    const renderer = new MarkdownRenderer();
    process.stdout.columns = 14;

    renderer.write('这是一个很长的第一段说明文字\n第二行贴边\n');

    const lines = output.split('\n').filter(Boolean);
    expect(lines[0]?.startsWith('● ')).toBe(true);
    expect(lines[1]?.startsWith('  ')).toBe(true);
    expect(lines[1]?.startsWith('● ')).toBe(false);
    expect(lines.at(-1)).toBe('第二行贴边');
  });

  it('starts a fresh lead paragraph after an explicit transcript boundary', () => {
    const renderer = new MarkdownRenderer();

    renderer.write('第一段\n');
    renderer.beginNewSegment();
    renderer.write('第二段\n');

    const lines = output.split('\n').filter(Boolean);
    expect(lines[0]).toBe('● 第一段');
    expect(lines[1]).toBe('● 第二段');
  });

  it('wraps ordered list items with a hanging indent aligned under the item text', () => {
    const renderer = new MarkdownRenderer();
    process.stdout.columns = 12;

    renderer.write('1. 这是一个很长的列表项\n');

    const lines = output.split('\n').filter(Boolean);
    expect(lines[0]).toBe('1. 这是一个');
    expect(lines[1]).toBe('   很长的列');
    expect(lines[2]).toBe('   表项');
  });

  it('wraps unordered list items with a hanging indent aligned under the item text', () => {
    const renderer = new MarkdownRenderer();
    process.stdout.columns = 12;

    renderer.write('- 这是一个很长的列表项\n');

    const lines = output.split('\n').filter(Boolean);
    expect(lines[0]).toBe('• 这是一个很');
    expect(lines[1]).toBe('  长的列表项');
  });
});
