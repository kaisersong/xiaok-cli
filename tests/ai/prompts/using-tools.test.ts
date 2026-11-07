import { describe, it, expect, afterEach } from 'vitest';
import { getUsingToolsSection } from '../../../src/ai/prompts/sections/using-tools.js';

describe('getUsingToolsSection — structural-first reading recipe', () => {
  it('describes natural visual requests and the permitted local table controls', () => {
    const section = getUsingToolsSection();
    expect(section).toContain('render_ui');
    expect(section).toContain('natural language');
    expect(section).toContain('tool name');
    expect(section).toContain('filtering');
    expect(section).toContain('CSV');
    expect(section).toContain('available');
    expect(section).toContain('permissions');
    expect(section).toContain('plain text');
    expect(section).not.toContain('not forms, scripts or interactive controls');
  });

  const original = process.env.XIAOK_NO_STRUCTURAL_FIRST;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.XIAOK_NO_STRUCTURAL_FIRST;
    } else {
      process.env.XIAOK_NO_STRUCTURAL_FIRST = original;
    }
  });

  it('includes the structural-first recipe by default', () => {
    delete process.env.XIAOK_NO_STRUCTURAL_FIRST;
    const section = getUsingToolsSection();
    expect(section).toContain('Structural-first reading');
    expect(section).toContain('lsp documentSymbol');
    // 仍保留原有工具语法说明
    expect(section).toContain('# Using your tools');
    expect(section).toContain('To read files use Read');
  });

  it('omits the recipe when XIAOK_NO_STRUCTURAL_FIRST=1 (A/B baseline / escape hatch)', () => {
    process.env.XIAOK_NO_STRUCTURAL_FIRST = '1';
    const section = getUsingToolsSection();
    expect(section).not.toContain('Structural-first reading');
    // baseline 臂仍保留其余工具语法
    expect(section).toContain('# Using your tools');
    expect(section).toContain('To read files use Read');
  });

  it('marks outlines as syntactic approximation, not semantic truth', () => {
    delete process.env.XIAOK_NO_STRUCTURAL_FIRST;
    const section = getUsingToolsSection();
    expect(section).toContain('syntactic approximations, not semantic truth');
  });
});
