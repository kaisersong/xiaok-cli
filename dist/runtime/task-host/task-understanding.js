export function buildTaskUnderstanding(input) {
    if (isProjectCreationPrompt(input.prompt)) {
        return buildProjectCreationUnderstanding(input);
    }
    if (!isSalesDeckOutputPrompt(input.prompt)) {
        return buildGenericUnderstanding(input);
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
function isSalesDeckOutputPrompt(prompt) {
    const deckFormat = /(?:\bpptx?\b|power\s*point|演示文稿|幻灯片|(?:pitch|sales|slide)\s+deck)/giu;
    const outputIntent = /(?:生成|制作|创建|新建|撰写|设计|输出|修改|改写|更新|优化|完善|重做|改造|转换(?:成|为)|(?:写|做|出)(?:一(?:个|份|版|套)?|个|份|版|套)?|准备|整理(?:成|为)?|\b(?:create|creating|build|building|draft|drafting|make|making|write|writing|design|designing|edit|editing|revise|revising|update|updating|improve|improving|generate|generating|produce|producing|prepare|preparing)\b)/giu;
    const negatedAction = /(?:不要|不用|无需|别|禁止|避免|\bdo\s+not|\bdon['’]t|\bnever|\bavoid)\s*$/iu;
    const deckToActionConnector = /^\s*(?:(?:帮我|给我|请|需要|要|再|重新|needs|should\s+be|must\s+be|please|help\s+me)\s*)*$/iu;
    const negatedDeckPrefix = /(?:不要|不用|无需|别|禁止|避免)\s*(?:(?:把|将|对)\s*)?(?:(?:这个|这份|这版|这套|该|此|现有(?:的)?)\s*)?$/u;
    const deckToActionSourceObject = /(?:分析|研究|摘要|总结|关键内容|内容|问题|评审|审阅|解读|翻译|提取|报告|结果)|\b(?:report|analysis|summary|review)\b/iu;
    return prompt.split(/[,，。.;；!?！？\r\n]+/u).some((fragment) => {
        for (const action of fragment.matchAll(outputIntent)) {
            const actionIndex = action.index ?? 0;
            if (negatedAction.test(fragment.slice(0, actionIndex))) {
                continue;
            }
            const afterAction = fragment.slice(actionIndex + action[0].length);
            for (const deck of afterAction.matchAll(deckFormat)) {
                const deckIndex = deck.index ?? 0;
                const beforeDeck = afterAction.slice(0, deckIndex);
                const afterDeck = afterAction.slice(deckIndex + deck[0].length);
                if (!isDeckSourceObject(beforeDeck, afterDeck)) {
                    return true;
                }
            }
        }
        for (const deck of fragment.matchAll(deckFormat)) {
            const deckIndex = deck.index ?? 0;
            if (negatedDeckPrefix.test(fragment.slice(0, deckIndex))) {
                continue;
            }
            const afterDeck = fragment.slice(deckIndex + deck[0].length);
            for (const action of afterDeck.matchAll(outputIntent)) {
                const actionIndex = action.index ?? 0;
                if (!deckToActionConnector.test(afterDeck.slice(0, actionIndex))) {
                    continue;
                }
                const afterAction = afterDeck.slice(actionIndex + action[0].length);
                if (!deckToActionSourceObject.test(afterAction)) {
                    return true;
                }
            }
        }
        return false;
    });
}
function isDeckSourceObject(beforeDeck, afterDeck) {
    const chineseSourceSuffix = /^\s*(?:(?:的|里的|中的)\s*)?(?:分析|研究|摘要|总结|关键内容|内容|问题|评审|审阅|解读|翻译|提取|报告|结果)(?:报告|结果)?/u;
    const englishSourcePrefix = /\b(?:report|analysis|summary|review)\b.*\b(?:about|of|on)\b.*$/iu;
    return chineseSourceSuffix.test(afterDeck) || englishSourcePrefix.test(beforeDeck);
}
function buildGenericUnderstanding(input) {
    return {
        goal: input.prompt.trim(),
        deliverable: '任务结果',
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
        suggestedPlan: [],
        nextAction: 'execute_task',
    };
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
