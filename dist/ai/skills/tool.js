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
            description: `Execute a skill within the main conversation

When users ask you to perform tasks, check if any of the available skills match. Skills provide specialized capabilities and domain knowledge.

When users reference a "slash command" or "/<something>" (e.g., "/kai-report-creator", "/kai-slide-creator"), they are referring to a skill. Use this tool to invoke it.

How to invoke:
- Use this tool with the skill name and optional arguments
- Examples:
  - name: "kai-report-creator" - invoke the report creator skill
  - name: "kai-slide-creator" - invoke the slide creator skill
  - name: "kai-html-export" - invoke the export skill

Important:
- Available skills are listed in system-reminder messages in the conversation
- When a skill matches the user's request, this is a BLOCKING REQUIREMENT: invoke the relevant Skill tool BEFORE generating any other response about the task
- NEVER mention a skill without actually calling this tool
- Do not invoke a skill that is already running
- If you see skill content already loaded in the current conversation turn, follow the instructions directly instead of calling this tool again`,
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
