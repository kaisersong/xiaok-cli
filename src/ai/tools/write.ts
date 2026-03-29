import { writeFileSync, mkdirSync, renameSync } from 'fs';
import { dirname, join } from 'path';
import type { Tool } from '../../types.js';

export const writeTool: Tool = {
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
    mkdirSync(dirname(file_path), { recursive: true });
    // 原子写入：temp 文件放在同目录，确保 rename 在同一文件系统（避免 Windows EXDEV 错误）
    const tmp = join(dirname(file_path), `.xiaok-tmp-${Date.now()}`);
    writeFileSync(tmp, content, 'utf-8');
    renameSync(tmp, file_path);
    return `已写入: ${file_path}（${content.length} 字符）`;
  },
};
