import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MarkdownRenderer } from '../../src/ui/markdown.js';
import { setColorsEnabled } from '../../src/ui/render.js';

describe('MarkdownRenderer', () => {
  let output = '';
  let originalWrite: typeof process.stdout.write;

  beforeEach(() => {
    setColorsEnabled(false);
    output = '';
    originalWrite = process.stdout.write;
    process.stdout.write = ((chunk: any) => {
      output += chunk;
      return true;
    }) as typeof process.stdout.write;
  });

  afterEach(() => {
    process.stdout.write = originalWrite;
    setColorsEnabled(false);
  });

  it('adds a shared left gutter to rendered assistant lines', () => {
    const renderer = new MarkdownRenderer();

    renderer.write('第一行\n- 列表项\n');

    expect(output).toContain('第一行\n');
    expect(output).toContain('• 列表项\n');
  });

  it('keeps the left gutter while streaming a partial line', () => {
    const renderer = new MarkdownRenderer();

    renderer.write('streaming');

    expect(output).toBe('streaming');
  });

  it('counts a flushed partial line as finalized rows', () => {
    const renderer = new MarkdownRenderer();

    renderer.write('streaming');
    const flushedRows = renderer.flush();

    expect(flushedRows).toBe(1);
    expect(renderer.getLineCount()).toBe(1);
  });
});
