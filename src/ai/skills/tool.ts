import type { Tool } from '../../types.js';
import type { SkillCatalog, SkillMeta } from './loader.js';

export function formatSkillPayload(skill: SkillMeta): string {
  return JSON.stringify({
    type: 'skill',
    name: skill.name,
    description: skill.description,
    path: skill.path,
    source: skill.source,
    tier: skill.tier,
    content: skill.content,
  }, null, 2);
}

function isSkillCatalog(value: SkillMeta[] | SkillCatalog): value is SkillCatalog {
  return !Array.isArray(value);
}

export function createSkillTool(skills: SkillMeta[] | SkillCatalog): Tool {
  const getSkill = (name: string): SkillMeta | undefined => {
    if (isSkillCatalog(skills)) {
      return skills.get(name);
    }
    return skills.find((skill) => skill.name === name);
  };

  const listSkillNames = (): string[] => {
    if (isSkillCatalog(skills)) {
      return skills.list().map((skill) => skill.name);
    }
    return skills.map((skill) => skill.name);
  };

  return {
    permission: 'safe',
    definition: {
      name: 'skill',
      description: '按名称加载 skill 内容并注入到当前对话上下文。当用户请求匹配某个 skill 的描述时使用。',
      inputSchema: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'skill 名称（不含 / 前缀）',
          },
        },
        required: ['name'],
      },
    },
    async execute(input) {
      const { name } = input as { name: string };
      const skill = getSkill(name);
      if (!skill) {
        const available = listSkillNames().join(', ') || '（无）';
        return `Error: 找不到 skill "${name}"。可用 skills：${available}`;
      }
      return formatSkillPayload(skill);
    },
  };
}
