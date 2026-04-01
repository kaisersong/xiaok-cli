import { buildSkillExecutionPlan } from './planner.js';
export function formatSkillPayload(skill) {
    return JSON.stringify({
        type: 'skill',
        name: skill.name,
        description: skill.description,
        path: skill.path,
        source: skill.source,
        tier: skill.tier,
        allowedTools: skill.allowedTools,
        executionContext: skill.executionContext,
        agent: skill.agent,
        model: skill.model,
        effort: skill.effort,
        dependsOn: skill.dependsOn,
        userInvocable: skill.userInvocable,
        whenToUse: skill.whenToUse,
        content: skill.content,
    }, null, 2);
}
function isSkillCatalog(value) {
    return !Array.isArray(value);
}
export function createSkillTool(skills, capabilityRegistry) {
    const listSkillNames = () => {
        if (isSkillCatalog(skills)) {
            return skills.list().map((skill) => skill.name);
        }
        return skills.map((skill) => skill.name);
    };
    const listSkillRecords = () => {
        if (isSkillCatalog(skills)) {
            return skills.list();
        }
        return skills;
    };
    const syncCapabilities = () => {
        for (const skill of listSkillRecords()) {
            capabilityRegistry?.register({
                kind: 'skill',
                name: skill.name,
                description: skill.description,
            });
        }
    };
    syncCapabilities();
    return {
        permission: 'safe',
        definition: {
            name: 'skill',
            description: '按名称加载一个或多个 skill，并返回包含依赖与执行上下文的 skill plan。',
            inputSchema: {
                type: 'object',
                properties: {
                    name: {
                        type: 'string',
                        description: '单个 skill 名称（不含 / 前缀）',
                    },
                    names: {
                        type: 'array',
                        items: { type: 'string' },
                        description: '多个 skill 名称。会自动解析依赖并去重。',
                    },
                },
            },
        },
        async execute(input) {
            syncCapabilities();
            const { name, names } = input;
            const requested = [
                ...(Array.isArray(names) ? names : []),
                ...(name ? [name] : []),
            ].filter(Boolean);
            if (requested.length === 0) {
                return 'Error: skill 工具至少需要提供 name 或 names';
            }
            try {
                const plan = buildSkillExecutionPlan(requested, skills);
                return JSON.stringify(plan, null, 2);
            }
            catch {
                const available = listSkillNames().join(', ') || '（无）';
                return `Error: 找不到 skill "${requested.join(', ')}"。可用 skills：${available}`;
            }
        },
    };
}
