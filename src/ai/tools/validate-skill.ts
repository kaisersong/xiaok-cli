import type { Tool } from '../../types.js';
import { validateSkillFile } from '../skills/quality.js';
import { assertWorkspacePath } from '../permissions/workspace.js';
import { getConfigDir } from '../../utils/config.js';

export interface ValidateSkillToolOptions {
  cwd?: string;
  configDir?: string;
}

export function createValidateSkillTool(options: ValidateSkillToolOptions = {}): Tool {
  const cwd = options.cwd ?? process.cwd();
  const configDir = options.configDir ?? getConfigDir();

  return {
    permission: 'safe',
    definition: {
      name: 'validate_skill',
      description: '校验 skill 的触发质量、结构完整性和可验证性',
      inputSchema: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: '要校验的 skill 文件绝对路径（支持单文件或目录型 skill 的 SKILL.md）',
          },
        },
        required: ['path'],
      },
    },
    async execute(input) {
      const { path } = input as { path: string };
      const resolvedPath = assertWorkspacePath(path, cwd, 'read', true);
      const result = await validateSkillFile(resolvedPath, {
        cwd,
        xiaokConfigDir: configDir,
      });
      return JSON.stringify(result, null, 2);
    },
  };
}

export const validateSkillTool = createValidateSkillTool();
