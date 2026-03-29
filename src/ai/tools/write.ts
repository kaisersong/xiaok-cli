import { writeFileSync, mkdirSync, renameSync } from 'fs';
import { dirname, join } from 'path';
import type { Tool } from '../../types.js';
import { assertWorkspacePath } from '../permissions/workspace.js';
import type { WorkspaceToolOptions } from './read.js';

export function createWriteTool(options: WorkspaceToolOptions = {}): Tool {
  const cwd = options.cwd ?? process.cwd();
  const allowOutsideCwd = options.allowOutsideCwd ?? false;

  return {
    permission: 'write',
    definition: {
      name: 'write',
      description: '写入文件内容（覆盖或新建），自动创建父目录',
      inputSchema: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: '文件绝对路径' },
          content: { type: 'string', description: '文件内容' },
        },
        required: ['file_path', 'content'],
      },
    },
    async execute(input) {
      const { file_path, content } = input as { file_path: string; content: string };
      const resolvedPath = assertWorkspacePath(file_path, cwd, 'write', allowOutsideCwd);
      mkdirSync(dirname(resolvedPath), { recursive: true });
      const tmp = join(dirname(resolvedPath), `.xiaok-tmp-${Date.now()}`);
      writeFileSync(tmp, content, 'utf-8');
      renameSync(tmp, resolvedPath);
      return `已写入: ${resolvedPath}（${content.length} 字符）`;
    },
  };
}

export const writeTool = createWriteTool();
