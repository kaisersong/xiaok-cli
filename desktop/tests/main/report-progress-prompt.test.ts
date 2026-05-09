import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Prompt regression tests for report_progress tool.
 * Ensures the system prompt in desktop-services.ts contains the expected
 * guidance for the LLM to correctly use report_progress.
 */

describe('report_progress prompt regression', () => {
  const desktopServicesPath = join(__dirname, '../../../desktop/electron/desktop-services.ts');
  let source: string;

  try {
    source = readFileSync(desktopServicesPath, 'utf-8');
  } catch {
    source = '';
  }

  it('system prompt lists report_progress in the available tools', () => {
    // The tool should be mentioned in the system prompt section
    expect(source).toContain('report_progress');
  });

  it('system prompt contains usage guidance for report_progress', () => {
    // Should have guidance about when to call report_progress
    expect(source).toContain('任务进度报告');
  });

  it('tool definition includes all five status values in enum', () => {
    // The JSON schema enum must include all valid statuses
    expect(source).toContain("'planned', 'running', 'completed', 'blocked', 'failed'");
  });

  it('tool definition has correct name and description in Chinese', () => {
    expect(source).toContain("name: 'report_progress'");
    expect(source).toContain('向用户报告任务计划和进度');
  });

  it('tool is registered with safe permission level', () => {
    // report_progress is a display-only tool, must be safe
    const toolDefRegex = /reportProgressTool[^}]*permission:\s*'safe'/s;
    expect(source).toMatch(toolDefRegex);
  });
});
