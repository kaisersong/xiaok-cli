import fg from 'fast-glob';
import type { Tool } from '../../types.js';

export const globTool: Tool = {
  permission: 'safe',
  definition: {
    name: 'glob',
    description: '按 glob 模式匹配文件，返回路径列表（按修改时间排序）',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Glob 模式，如 **/*.ts' },
        path: { type: 'string', description: '搜索根目录（可选，默认当前目录）' },
      },
      required: ['pattern'],
    },
  },
  async execute(input) {
    const { pattern, path: cwd = process.cwd() } = input as { pattern: string; path?: string };
    try {
      const files = await fg(pattern, { cwd, absolute: true, stats: true });
      files.sort((a, b) => (b.stats?.mtimeMs ?? 0) - (a.stats?.mtimeMs ?? 0));
      if (files.length === 0) return '（无匹配文件）';
      return files.map(f => f.path).join('\n');
    } catch (e) {
      return `Error: ${String(e)}`;
    }
  },
};
