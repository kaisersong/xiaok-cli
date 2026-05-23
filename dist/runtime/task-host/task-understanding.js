export function buildTaskUnderstanding(input) {
    if (isProjectCreationPrompt(input.prompt)) {
        return buildProjectCreationUnderstanding(input);
    }
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
function buildProjectCreationUnderstanding(input) {
    return {
        goal: input.prompt.trim(),
        deliverable: inferProjectDeliverable(input.prompt),
        taskType: 'unknown',
        audience: '用户',
        inputs: input.materials.map((material) => ({
            materialId: material.materialId,
            name: material.originalName,
            role: material.role,
            parseStatus: material.parseStatus,
            parseSummary: material.parseSummary,
        })),
        missingInfo: [],
        assumptions: [],
        riskLevel: 'medium',
        suggestedPlan: [
            { id: 'create_project', label: '创建项目并分配智能体', status: 'planned' },
            { id: 'track_project_delivery', label: '跟踪项目交付物', status: 'planned' },
        ],
        nextAction: 'create_project',
    };
}
function isProjectCreationPrompt(prompt) {
    return /(?:创建|新建).{0,20}项目|create_project|swarm\s*project/iu.test(prompt);
}
function inferProjectDeliverable(prompt) {
    if (/报告|markdown|\.md\b/iu.test(prompt)) {
        return 'Swarm 项目与后续报告产出';
    }
    return 'Swarm 项目';
}
function buildGoal(prompt) {
    const customer = inferCustomer(prompt);
    return `为 ${customer}生成制造业数字化方案 PPT 初稿`;
}
function inferCustomer(prompt) {
    const spacedCustomer = prompt.match(/([A-Z])\s*客户/u);
    if (spacedCustomer?.[1]) {
        return `${spacedCustomer[1]} 客户`;
    }
    return '目标客户';
}
function inferAudience(prompt) {
    if (/CIO/iu.test(prompt)) {
        return '客户 CIO / 管理层';
    }
    if (/管理层|高管/u.test(prompt)) {
        return '客户管理层';
    }
    return '客户决策人';
}
