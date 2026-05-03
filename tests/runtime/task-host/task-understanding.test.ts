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
