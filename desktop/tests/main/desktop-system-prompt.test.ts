import { describe, expect, it } from 'vitest';
import { homedir } from 'node:os';
import { buildDesktopSystemPrompt, VISUAL_PDF_EXPORT_GUIDANCE } from '../../electron/desktop-system-prompt.js';

describe('Desktop system prompt contract', () => {
  it('keeps the base policy compact and uses runtime environment paths', () => {
    const prompt = buildDesktopSystemPrompt();
    expect(prompt.length).toBeLessThanOrEqual(5000);
    expect(prompt).toContain(homedir());
    expect(prompt).toContain(process.cwd());
    expect(prompt).toContain('<currentDate>');
    expect(prompt).not.toContain('你有以下工具可用');
  });

  it('does not turn action bias into blanket authorization or denial bypass', () => {
    const prompt = buildDesktopSystemPrompt();
    expect(prompt).not.toContain('用户已经授权你使用所有工具');
    expect(prompt).toMatch(/授权.*范围|范围.*授权/);
    expect(prompt).toMatch(/拒绝.*(?:绕过|改用)|(?:绕过|改用).*拒绝/);
    expect(prompt).toContain('user-owned');
    expect(prompt).toContain('assistant-owned');
    expect(prompt).toContain('interval');
    expect(prompt).toMatch(/SubAgent.*(?:不代表|不等于).*项目/);
  });

  it('preserves source, knowledge, material and multi-deliverable rules', () => {
    const prompt = buildDesktopSystemPrompt();
    for (const rule of ['notebook_read', 'kb_search', 'read_material', 'materialId', 'Skill content:', 'report_progress', '每个交付物']) {
      expect(prompt).toContain(rule);
    }
    expect(prompt).toMatch(/未验证|未能验证/);
    expect(prompt).toMatch(/通知.*自动执行|自动执行.*通知/);
  });

  it('preserves workflow repair fences and visual delivery over default chat formatting', () => {
    const prompt = buildDesktopSystemPrompt();
    for (const rule of ['executionMode="workflow"', 'parallel(', 'waitForCompletion=false',
      'ambiguous_project', 'expectedTaskUpdatedAt', 'expectedPrimaryTaskId', 'needs_conversation',
      'recovery_budget_exceeded', 'repair_project_task_from_file', 'resumeWorkflowRunId',
      '不要传 script', 'gateDecision', 'HTML']) {
      expect(prompt).toContain(rule);
    }
    expect(prompt).toContain(VISUAL_PDF_EXPORT_GUIDANCE);
    expect(prompt).toMatch(/(?:用户|技能).*格式.*优先|优先.*(?:用户|技能).*格式/);
    expect(prompt).not.toContain('只在用户明确要求"生成网页"');
  });
});
