import { describe, it, expect } from 'vitest';
import { buildDesktopSystemPrompt } from '../../electron/desktop-system-prompt.js';
import { createReportProgressTool } from '../../electron/desktop-services.js';

/**
 * Prompt regression tests for report_progress tool.
 * Ensures the actual generated system prompt contains the expected
 * guidance for the LLM to correctly use report_progress.
 */

describe('report_progress prompt regression', () => {
  const prompt = buildDesktopSystemPrompt();
  const tool = createReportProgressTool();

  it('system prompt lists report_progress in the available tools', () => {
    // The tool should be mentioned in the system prompt section
    expect(prompt).toContain(tool.definition.name);
  });

  it('system prompt contains usage guidance for report_progress', () => {
    // Should have guidance about when to call report_progress
    expect(prompt).toMatch(/多步任务用 report_progress.*随进展更新/);
    expect(prompt).toContain('每个交付物单独列步骤');
  });

  it('tool definition includes all five status values in enum', () => {
    // The JSON schema enum must include all valid statuses
    const schema = tool.definition.inputSchema as { properties: { steps: { items: { properties: { status: { enum: string[] } } } } } };
    expect(schema.properties.steps.items.properties.status.enum).toEqual(['planned', 'running', 'completed', 'blocked', 'failed']);
  });

  it('tool definition has correct name and description in Chinese', () => {
    expect(tool.definition.name).toBe('report_progress');
    expect(tool.definition.description).toContain('向用户报告任务计划和进度');
  });

  it('tool is registered with safe permission level', () => {
    // report_progress is a display-only tool, must be safe
    expect(tool.permission).toBe('safe');
  });
});
