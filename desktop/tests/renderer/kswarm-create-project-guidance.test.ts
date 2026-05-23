import { describe, expect, it } from 'vitest';
import { buildCreateProjectPlanningGuidance } from '../../renderer/src/hooks/useKSwarmClient';
import { en } from '../../renderer/src/locales/en';
import { zh } from '../../renderer/src/locales/zh';

describe('KSwarm create project planning guidance', () => {
  it('never rewrites visible goal or requirements; derived format details stay in planning guidance', () => {
    const markdown = buildCreateProjectPlanningGuidance({
      goal: '输出OpenAI本月分析报告，最终用 Markdown 交付',
      requirements: '不要改写我的目标和要求。',
      principles: [],
    });
    expect(markdown.visibleRequirements).toBe('不要改写我的目标和要求。');
    expect(markdown.planningGuidance).toMatch(/Markdown/i);
    expect(markdown.planningGuidance).toMatch(/计划|plan/i);
    expect(markdown.planningGuidance).not.toContain('输出OpenAI本月分析报告，最终用 Markdown 交付');
    expect(markdown.planningGuidance).not.toContain('不要改写我的目标和要求。');

    const pptx = buildCreateProjectPlanningGuidance({
      goal: '制作技术大会演示文稿，交付 PPTX 文件',
      requirements: '保持原始标题。',
      principles: [],
    });
    expect(pptx.visibleRequirements).toBe('保持原始标题。');
    expect(pptx.planningGuidance).toMatch(/PPTX/i);
    expect(pptx.planningGuidance).toMatch(/计划|plan/i);
    expect(pptx.planningGuidance).not.toContain('制作技术大会演示文稿，交付 PPTX 文件');
    expect(pptx.planningGuidance).not.toContain('保持原始标题。');
  });

  it('keeps visible requirements separate from derived project principles', () => {
    const guidance = buildCreateProjectPlanningGuidance({
      goal: '输出OpenAI本月分析报告',
      requirements: '使用中文，保留来源。',
      principles: [
        { id: 'p1', content: '所有结论必须标注来源', scenarios: ['planning'], enabled: true, createdAt: 1 },
      ],
    });

    expect(guidance.visibleRequirements).toBe('使用中文，保留来源。');
    expect(guidance.planningGuidance).toMatch(/所有结论必须标注来源/);
    expect(guidance.planningGuidance).toMatch(/知识与规则（系统规划指导，不写入用户可见要求）/);
    expect(guidance.planningGuidance).toMatch(/报告.*report renderer.*HTML/i);
    expect(guidance.planningGuidance).not.toContain('## 项目原则（必须遵守）\n\n以下原则适用于当前阶段，请严格遵循：\n\n');
  });

  it('labels the Projects rules surface as Knowledge & Rules instead of project-only principles', () => {
    expect(zh.projectsPrinciplesTab).toBe('知识与规则');
    expect(zh.projectsPrinciplesEmpty).toBe('还没有知识与规则');
    expect(zh.projectsPrinciplesEmptyDesc).toMatch(/项目管理知识与规则/);
    expect(en.projectsPrinciplesTab).toBe('Knowledge & Rules');
    expect(en.projectsPrinciplesEmpty).toBe('No knowledge or rules yet');
    expect(en.projectsPrinciplesEmptyDesc).toMatch(/project-management knowledge and rules/i);
  });

  it('treats high-level analysis projects as report-like deliverables without rewriting visible fields', () => {
    const guidance = buildCreateProjectPlanningGuidance({
      goal: '金蝶今年AI产品分析',
      requirements: '要进行2轮分析，是提供给研发高层看的内容，要有高度',
      principles: [],
    });

    expect(guidance.visibleRequirements).toBe('要进行2轮分析，是提供给研发高层看的内容，要有高度');
    expect(guidance.planningGuidance).toMatch(/report renderer/i);
    expect(guidance.planningGuidance).toMatch(/HTML/);
    expect(guidance.planningGuidance).not.toContain('金蝶今年AI产品分析');
    expect(guidance.planningGuidance).not.toContain('要进行2轮分析，是提供给研发高层看的内容，要有高度');
  });

  it('routes slide and presentation goals to slide renderer guidance', () => {
    const guidance = buildCreateProjectPlanningGuidance({
      goal: '制作技术大会演示文稿',
      requirements: '',
      principles: [],
    });

    expect(guidance.visibleRequirements).toBe('');
    expect(guidance.planningGuidance).toMatch(/slide renderer/i);
    expect(guidance.planningGuidance).toMatch(/HTML/);
    expect(guidance.planningGuidance).not.toMatch(/PPTX.*default/i);
  });
});
