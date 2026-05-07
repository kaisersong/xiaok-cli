import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MarkdownRenderer } from '../../src/ui/markdown.js';
import { setColorsEnabled } from '../../src/ui/render.js';
import { getDisplayWidth, stripAnsi } from '../../src/ui/text-metrics.js';

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
    expect(lines.at(-1)).toBe('  第二行贴边');
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

  it('indents continuation text lines with 2-space alignment', () => {
    const renderer = new MarkdownRenderer();

    renderer.write('Lead paragraph line.\n');
    renderer.write('Second paragraph line.\n');
    renderer.write('Third line.\n');
    renderer.flush();

    const lines = output.split('\n').filter(Boolean);
    expect(lines[0]?.startsWith('● ')).toBe(true);
    expect(lines[1]?.startsWith('  ')).toBe(true);
    expect(lines[1]).toBe('  Second paragraph line.');
    expect(lines[2]?.startsWith('  ')).toBe(true);
    expect(lines[2]).toBe('  Third line.');
  });

  describe('mermaid rendering', () => {
    it('renders a flowchart mermaid block as ASCII art', () => {
      const renderer = new MarkdownRenderer();

      renderer.write('```mermaid\ngraph LR\n  A --> B --> C\n```\n');

      expect(output).toContain('─');   // box-drawing chars present
      expect(output).not.toContain('graph LR');  // raw syntax not leaked
      expect(output).not.toContain('```');
    });

    it('renders a sequence diagram mermaid block as ASCII art', () => {
      const renderer = new MarkdownRenderer();

      renderer.write('```mermaid\nsequenceDiagram\n  Alice->>Bob: Hello\n  Bob-->>Alice: Hi\n```\n');

      expect(output).toContain('Alice');
      expect(output).toContain('Bob');
      expect(output).not.toContain('sequenceDiagram');
      expect(output).not.toContain('```');
    });

    it('falls back to raw source when mermaid syntax is invalid', () => {
      const renderer = new MarkdownRenderer();

      renderer.write('```mermaid\nnot valid mermaid at all\n```\n');

      expect(output).toContain('not valid mermaid at all');
    });

    it('renders non-mermaid code blocks normally with fence decorations', () => {
      const renderer = new MarkdownRenderer();

      renderer.write('```ts\nconst x = 1;\n```\n');

      // Should have fence decorations (not mermaid path)
      expect(output).toContain('╭─');
      expect(output).toContain('╰─');
      expect(output).not.toContain('graph');
    });
  });

  describe('horizontal rule', () => {
    it('adds blank lines above and below the rule', () => {
      const renderer = new MarkdownRenderer();

      renderer.write('before\n---\nafter\n');

      const idx = output.indexOf('─');
      expect(idx).toBeGreaterThan(-1);
      // char before the rule line should be a newline
      expect(output[idx - 1]).toBe('\n');
      // char after the rule line should be a newline
      const ruleEnd = output.indexOf('\n', idx);
      expect(output[ruleEnd + 1]).toBe('\n');
    });
  });

  describe('mermaid rendering', () => {
    it('renders a flowchart mermaid block as ASCII instead of raw syntax', () => {
      const renderer = new MarkdownRenderer();

      renderer.write('```mermaid\n');
      renderer.write('graph LR\n');
      renderer.write('  A --> B --> C\n');
      renderer.write('```\n');

      // Should contain box-drawing characters, not raw mermaid syntax
      expect(output).toContain('─');
      expect(output).not.toContain('graph LR');
      expect(output).not.toContain('```mermaid');
    });

    it('renders a sequence diagram as ASCII', () => {
      const renderer = new MarkdownRenderer();

      renderer.write('```mermaid\n');
      renderer.write('sequenceDiagram\n');
      renderer.write('  Alice->>Bob: Hello\n');
      renderer.write('  Bob-->>Alice: Hi\n');
      renderer.write('```\n');

      expect(output).toContain('Alice');
      expect(output).toContain('Bob');
      expect(output).not.toContain('sequenceDiagram');
      expect(output).not.toContain('```');
    });

    it('renders a state diagram as ASCII', () => {
      const renderer = new MarkdownRenderer();

      renderer.write('```mermaid\n');
      renderer.write('stateDiagram-v2\n');
      renderer.write('  [*] --> Idle\n');
      renderer.write('  Idle --> Running: start\n');
      renderer.write('  Running --> [*]: stop\n');
      renderer.write('```\n');

      expect(output).toContain('Idle');
      expect(output).not.toContain('stateDiagram-v2');
    });

    it('falls back to raw source when mermaid diagram is invalid', () => {
      const renderer = new MarkdownRenderer();

      renderer.write('```mermaid\n');
      renderer.write('this is not valid mermaid\n');
      renderer.write('```\n');

      // Should not throw, should output something
      expect(output.length).toBeGreaterThan(0);
    });

    it('does not output opening or closing fence for mermaid blocks', () => {
      const renderer = new MarkdownRenderer();

      renderer.write('```mermaid\n');
      renderer.write('graph TD\n');
      renderer.write('  A --> B\n');
      renderer.write('```\n');

      expect(output).not.toContain('```');
      expect(output).not.toContain('╭─');
      expect(output).not.toContain('╰─');
    });
  });

  it('clears every visual row of a soft-wrapped pending line before flushing it formatted', () => {
    const renderer = new MarkdownRenderer();
    process.stdout.columns = 20;
    const finalParagraph = '两个文件均为零依赖，可直接浏览器打开查看；幻灯片按 F5 进入演讲模式。';

    renderer.write(finalParagraph);
    const pendingRows = Math.ceil(getDisplayWidth(stripAnsi(output)) / process.stdout.columns);
    expect(pendingRows).toBeGreaterThan(1);

    output = '';
    renderer.flush();

    const clearSequences = output.match(/\x1b\[1G\x1b\[2K/g) ?? [];
    expect(output).toContain(`\x1b[${pendingRows - 1}A`);
    expect(clearSequences).toHaveLength(pendingRows);
    expect(output).toContain('● 两个文件均为零依赖');
  });
});
