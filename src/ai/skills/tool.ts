import type { Tool } from '../../types.js';
import type { SkillMeta } from './loader.js';

export function createSkillTool(skills: SkillMeta[]): Tool {
  const skillMap = new Map(skills.map(s => [s.name, s]));

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
      const skill = skillMap.get(name);
      if (!skill) {
        const available = Array.from(skillMap.keys()).join(', ') || '（无）';
        return `Error: 找不到 skill "${name}"。可用 skills：${available}`;
      }
      return skill.content;
    },
  };
}
