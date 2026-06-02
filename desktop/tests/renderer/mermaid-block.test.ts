import { describe, expect, it } from 'vitest';
import { createMermaidConfig, shouldFallbackToMermaidSource } from '../../renderer/src/components/MermaidBlock';

describe('MermaidBlock fallback detection', () => {
  it('falls back to source when mermaid returns a structural SVG without readable diagram text', () => {
    const source = `flowchart TD
  A[生成 JS 脚本] --> B[并行调度]
  B --> C[交叉验证]`;
    const blankSvg = '<svg xmlns="http://www.w3.org/2000/svg"><g><path d="M0 0L10 10"></path></g></svg>';

    expect(shouldFallbackToMermaidSource(blankSvg, source)).toBe(true);
  });

  it('keeps rendered SVG when Mermaid output contains readable label text', () => {
    const source = `flowchart TD
  A[生成 JS 脚本] --> B[并行调度]`;
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><g><path d="M0 0L10 10"></path><text>生成 JS 脚本</text></g></svg>';

    expect(shouldFallbackToMermaidSource(svg, source)).toBe(false);
  });

  it('falls back for empty Mermaid source', () => {
    expect(shouldFallbackToMermaidSource('<svg><text>unused</text></svg>', '')).toBe(true);
  });

  it('does not pass CSS variables into Mermaid theme colors because Mermaid parses colors eagerly', () => {
    const config = createMermaidConfig();
    const values = Object.values(config.themeVariables ?? {});

    expect(values.some(value => String(value).includes('var('))).toBe(false);
  });
});
