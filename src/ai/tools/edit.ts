import { readFileSync, writeFileSync, renameSync } from 'fs';
import { dirname, join } from 'path';
import type { Tool } from '../../types.js';
import { assertWorkspacePath } from '../permissions/workspace.js';
import type { WorkspaceToolOptions } from './read.js';

export function createEditTool(options: WorkspaceToolOptions = {}): Tool {
  const cwd = options.cwd ?? process.cwd();
  const allowOutsideCwd = options.allowOutsideCwd ?? false;

  return {
    permission: 'write',
    definition: {
      name: 'edit',
      description: '在文件中精确替换字符串。old_string 必须在文件中唯一出现。',
      inputSchema: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: '文件绝对路径' },
          old_string: { type: 'string', description: '要替换的字符串（必须唯一）' },
          new_string: { type: 'string', description: '替换后的字符串' },
        },
        required: ['file_path', 'old_string', 'new_string'],
      },
    },
    async execute(input) {
      const { file_path, old_string, new_string } = input as {
        file_path: string;
        old_string: string;
        new_string: string;
      };

      const resolvedPath = assertWorkspacePath(file_path, cwd, 'write', allowOutsideCwd);
      let content: string;
      try {
        content = readFileSync(resolvedPath, 'utf-8');
      } catch {
        return `Error: 文件不存在: ${resolvedPath}`;
      }

      const occurrences = content.split(old_string).length - 1;
      if (occurrences === 0) return 'Error: old_string 在文件中不存在';
      if (occurrences > 1) return `Error: old_string 在文件中出现了 ${occurrences} 次，必须唯一`;

      const updated = content.split(old_string).join(new_string);
      const tmp = join(dirname(resolvedPath), `.xiaok-tmp-${Date.now()}`);
      writeFileSync(tmp, updated, 'utf-8');
      renameSync(tmp, resolvedPath);
      return `已编辑: ${resolvedPath}`;
    },
  };
}

export const editTool = createEditTool();
