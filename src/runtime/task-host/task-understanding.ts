import type { MaterialRecord, TaskUnderstanding } from './types.js';

interface BuildTaskUnderstandingInput {
  prompt: string;
  materials: MaterialRecord[];
}

export function buildTaskUnderstanding(input: BuildTaskUnderstandingInput): TaskUnderstanding {
  return {
    goal: buildGoal(input.prompt),
    deliverable: '可继续编辑的 PPT 初稿',
    taskType: 'sales_deck',
    audience: inferAudience(input.prompt),
    inputs: input.materials.map((material) => ({
      materialId: material.materialId,
      name: material.originalName,
      role: material.role,
      parseStatus: material.parseStatus,
      parseSummary: material.parseSummary,
    })),
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
  };
}

function buildGoal(prompt: string): string {
  const customer = inferCustomer(prompt);
  return `为 ${customer}生成制造业数字化方案 PPT 初稿`;
}

function inferCustomer(prompt: string): string {
  const spacedCustomer = prompt.match(/([A-Z])\s*客户/u);
  if (spacedCustomer?.[1]) {
    return `${spacedCustomer[1]} 客户`;
  }
  return '目标客户';
}

function inferAudience(prompt: string): string {
  if (/CIO/iu.test(prompt)) {
    return '客户 CIO / 管理层';
  }
  if (/管理层|高管/u.test(prompt)) {
    return '客户管理层';
  }
  return '客户决策人';
}
