import { describe, expect, it } from 'vitest';
import { ToolExplorer } from '../../src/ui/tool-explorer.js';

// Strip ANSI escape codes for plain-text assertions.
function strip(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

describe('ToolExplorer', () => {
  it('groups exploration activity under an indented Explored block', () => {
    const explorer = new ToolExplorer();

    const first = strip(explorer.record('tool_search', { query: 'LOW_SIGNAL_TOOL_NAMES|describeToolActivity' }));
    const second = strip(explorer.record('grep', { pattern: 'describeToolActivity|tool_started in yzj-runtime-notifier.ts' }));

    expect(first.startsWith('\n\n')).toBe(true);
    expect(first).toContain('  ╭─ Explored');
    expect(first).toContain('  │ Search LOW_SIGNAL_TOOL_NAMES|describeToolActivity');
    expect(second).not.toContain('  ╭─ Explored');
    expect(second).toContain('  │ Search describeToolActivity|tool_started in yzj-runtime-notifier.ts');
  });

  it('groups meaningful command execution under a stable Ran block', () => {
    const explorer = new ToolExplorer();

    const output = strip(explorer.record('bash', { command: 'python3 export-pptx.py slides.html slides.pptx' }));

    expect(output).toBe('\n\n  ╭─ Ran\n  │ 导出 PPT\n');
  });

  it('keeps the concrete bash command in the Ran block when the generic summary would hide it', () => {
    const explorer = new ToolExplorer();

    const output = strip(explorer.record('bash', {
      command: 'sqlite3 ~/.mempalace/knowledge_graph.sqlite3 ".tables" 2>/dev/null && echo ---',
    }));

    expect(output).toContain('  ╭─ Ran');
    expect(output).toContain('sqlite3 ~/.mempalace/knowledge_graph.sqlite3 ".tables" 2>/dev/null && echo ---');
    expect(output).not.toContain('执行本地命令');
  });

  it('does not inline heredoc bodies into the Ran block preview', () => {
    const explorer = new ToolExplorer();

    const output = strip(explorer.record('bash', {
      command: "cat > /tmp/report.html << 'HTMLEOF' <!DOCTYPE html> <html><body>huge body</body></html>",
    }));

    expect(output).toContain('  ╭─ Ran');
    expect(output).toContain("cat > /tmp/report.html");
    expect(output).not.toContain('<!DOCTYPE html>');
    expect(output).not.toContain('huge body');
  });

  it('groups consecutive file changes under a Changed block', () => {
    const explorer = new ToolExplorer();

    expect(strip(explorer.record('write', { file_path: '/tmp/demo/report.md' }))).toBe('\n\n  ╭─ Changed\n  │ Wrote report.md\n');
    expect(strip(explorer.record('edit', { file_path: '/tmp/demo/render.ts' }))).toBe('  │ Edited render.ts\n');
  });

  it('starts a new group when switching between activity categories', () => {
    const explorer = new ToolExplorer();

    explorer.record('tool_search', { query: 'statusbar.ts' });
    const output = strip(explorer.record('edit', { file_path: '/tmp/demo/statusbar.ts' }));

    expect(output).toBe('\n\n  ╭─ Changed\n  │ Edited statusbar.ts\n');
  });

  it('resets grouping between turns', () => {
    const explorer = new ToolExplorer();

    explorer.record('tool_search', { query: 'render.ts' });
    explorer.reset();
    const nextTurn = strip(explorer.record('tool_search', { query: 'yzj-context.ts' }));

    expect(nextTurn).toContain('  ╭─ Explored');
  });

  it('suppresses internal using-superpowers skill loads from the transcript activity rail', () => {
    const explorer = new ToolExplorer();

    const output = strip(explorer.record('skill', { name: 'using-superpowers' }));

    expect(output).toBe('');
  });
});
