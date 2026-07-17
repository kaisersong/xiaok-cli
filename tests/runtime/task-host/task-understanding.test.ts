import { describe, expect, it } from 'vitest';
import { buildTaskUnderstanding } from '../../../src/runtime/task-host/task-understanding.js';
import type { MaterialRecord } from '../../../src/runtime/task-host/types.js';

describe('TaskUnderstanding projection', () => {
  it('builds a stable sales deck understanding from prompt and material roles', () => {
    const materials: MaterialRecord[] = [
      createMaterial('mat_customer', 'A客户需求.docx', 'customer_material'),
      createMaterial('mat_product', '产品白皮书.pdf', 'product_material'),
      createMaterial('mat_template', '历史制造业方案.pptx', 'template_material'),
    ];

    const understanding = buildTaskUnderstanding({
      prompt: '帮我基于这些材料，生成一版给 A 客户 CIO 汇报的制造业数字化方案 PPT 初稿。',
      materials,
    });

    expect(understanding).toEqual({
      goal: '为 A 客户生成制造业数字化方案 PPT 初稿',
      deliverable: '可继续编辑的 PPT 初稿',
      taskType: 'sales_deck',
      audience: '客户 CIO / 管理层',
      inputs: [
        { materialId: 'mat_customer', name: 'A客户需求.docx', role: 'customer_material', parseStatus: 'pending' },
        { materialId: 'mat_product', name: '产品白皮书.pdf', role: 'product_material', parseStatus: 'pending' },
        { materialId: 'mat_template', name: '历史制造业方案.pptx', role: 'template_material', parseStatus: 'pending' },
      ],
      missingInfo: ['报价表', '客户成功案例'],
      assumptions: ['报价相关页面先使用占位说明'],
      riskLevel: 'medium',
      suggestedPlan: [
        { id: 'parse_materials', label: '解析客户材料', status: 'planned' },
        { id: 'summarize_customer_needs', label: '归并客户痛点', status: 'planned' },
        { id: 'match_product_capabilities', label: '匹配产品能力', status: 'planned' },
        { id: 'draft_solution_outline', label: '生成方案大纲', status: 'planned' },
        { id: 'confirm_outline_direction', label: '等待用户确认', status: 'planned' },
      ],
      nextAction: 'confirm_outline_direction',
    });
  });

  it('does not reuse sales-deck assumptions for project creation prompts', () => {
    const understanding = buildTaskUnderstanding({
      prompt: '创建项目, 让2个智能体搞定本月Claude动态分析，输出报告',
      materials: [],
    });

    expect(understanding.taskType).toBe('unknown');
    expect(understanding.goal).toBe('创建项目, 让2个智能体搞定本月Claude动态分析，输出报告');
    expect(understanding.deliverable).toBe('Swarm 项目与后续报告产出');
    expect(understanding.missingInfo).toEqual([]);
    expect(understanding.assumptions).toEqual([]);
    expect(understanding.suggestedPlan).toEqual([
      { id: 'create_project', label: '创建项目并分配智能体', status: 'planned' },
      { id: 'track_project_delivery', label: '跟踪项目交付物', status: 'planned' },
    ]);
    expect(understanding.nextAction).toBe('create_project');
  });

  it('keeps ordinary research prompts generic', () => {
    const prompt = '找YC合伙人Diana Hu最新的视频的关键内容，how to build an AI native company，详细的内容';
    const understanding = buildTaskUnderstanding({ prompt, materials: [] });

    expect(understanding).toEqual({
      goal: prompt,
      deliverable: '任务结果',
      taskType: 'unknown',
      audience: '用户',
      inputs: [],
      missingInfo: [],
      assumptions: [],
      riskLevel: 'medium',
      suggestedPlan: [],
      nextAction: 'execute_task',
    });
    expect(JSON.stringify(understanding)).not.toMatch(/制造业|PPT|报价表|客户成功案例/);
  });

  it('does not treat analysis of an existing PPT as sales-deck generation', () => {
    const prompt = '分析这个 PPT 里写了什么，并告诉我关键问题';
    const understanding = buildTaskUnderstanding({
      prompt,
      materials: [],
    });

    expect(understanding).toEqual({
      goal: prompt,
      deliverable: '任务结果',
      taskType: 'unknown',
      audience: '用户',
      inputs: [],
      missingInfo: [],
      assumptions: [],
      riskLevel: 'medium',
      suggestedPlan: [],
      nextAction: 'execute_task',
    });
    expect(JSON.stringify(understanding)).not.toMatch(/制造业|报价表|客户成功案例/);
  });

  it('keeps report generation generic when no deck format is requested', () => {
    const prompt = '生成一份 AI 研究报告';
    const understanding = buildTaskUnderstanding({ prompt, materials: [] });

    expect(understanding).toEqual({
      goal: prompt,
      deliverable: '任务结果',
      taskType: 'unknown',
      audience: '用户',
      inputs: [],
      missingInfo: [],
      assumptions: [],
      riskLevel: 'medium',
      suggestedPlan: [],
      nextAction: 'execute_task',
    });
  });

  it.each([
    '分析这个 PPT，并生成一份研究报告',
    '不要制作 PPT，只输出研究报告',
    '不要把这个 PPT 优化',
    'PPT 并生成研究报告',
    '写一份这个 PPT 的分析报告',
    '生成关于这个 PPT 的研究报告',
    '输出 PPT 分析结果',
    '输出 PPT 分析报告',
    '输出 PPT 关键内容',
    'Write a report about this PowerPoint',
    'Generate an analysis of this slide deck',
  ])('keeps mixed or negated deck prompts generic: %s', (prompt) => {
    const understanding = buildTaskUnderstanding({ prompt, materials: [] });

    expect(understanding).toEqual({
      goal: prompt,
      deliverable: '任务结果',
      taskType: 'unknown',
      audience: '用户',
      inputs: [],
      missingInfo: [],
      assumptions: [],
      riskLevel: 'medium',
      suggestedPlan: [],
      nextAction: 'execute_task',
    });
  });

  it.each([
    '帮我做个 PPT',
    '准备一份演示文稿',
    '整理成 PPT',
    '出一版 PPT',
    'Prepare a slide deck for the board',
    '请把这个 PPT 优化一下',
    'PPT 帮我生成一版',
    'This slide deck needs updating',
  ])('recognizes explicit deck output intent: %s', (prompt) => {
    const understanding = buildTaskUnderstanding({ prompt, materials: [] });

    expect(understanding.taskType).toBe('sales_deck');
    expect(understanding.deliverable).toBe('可继续编辑的 PPT 初稿');
  });

  it('recognizes explicit PowerPoint generation as a sales deck', () => {
    const understanding = buildTaskUnderstanding({
      prompt: 'Create a PowerPoint presentation for the customer CIO',
      materials: [],
    });

    expect(understanding.taskType).toBe('sales_deck');
    expect(understanding.deliverable).toBe('可继续编辑的 PPT 初稿');
  });
});

function createMaterial(
  materialId: string,
  originalName: string,
  role: MaterialRecord['role'],
): MaterialRecord {
  return {
    materialId,
    taskId: 'task_1',
    originalName,
    workspacePath: `/workspace/task_1/${originalName}`,
    mimeType: 'application/octet-stream',
    sizeBytes: 10,
    sha256: 'a'.repeat(64),
    role,
    roleSource: 'user',
    parseStatus: 'pending',
    createdAt: 1,
  };
}
