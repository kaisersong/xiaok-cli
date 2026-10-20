import type { Tool } from '../../types.js';
import { runBoundedGlob } from './bounded-glob.js';
import { appendPaginationNotice, paginateItems, truncateText } from './truncation.js';

export const globTool: Tool = {
  permission: 'safe',
  definition: {
    name: 'glob',
    description: '按 glob 模式匹配文件或目录，返回路径列表（按修改时间排序）。查找目录时使用 type=directory；搜索超限时缩小 path，head_limit 仅控制输出分页。',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Glob 模式，如 **/*.ts' },
        path: { type: 'string', description: '搜索根目录（可选，默认当前目录）' },
        type: { type: 'string', enum: ['file', 'directory', 'all'], description: '匹配类型（默认 file；查找目录用 directory）' },
        offset: { type: 'number', description: '分页偏移量（默认 0）' },
        head_limit: { type: 'number', description: '单次返回条数（默认 50）' },
        max_chars: { type: 'number', description: '输出字符上限（默认 12000）' },
      },
      required: ['pattern'],
    },
  },
  async execute(input, context) {
    const {
      pattern,
      path: cwd = process.cwd(),
      offset = 0,
      head_limit = 50,
      max_chars = 12_000,
      type = 'file',
    } = input as {
      pattern: string;
      path?: string;
      offset?: number;
      head_limit?: number;
      max_chars?: number;
      type?: 'file' | 'directory' | 'all';
    };
    try {
      const files = await runBoundedGlob({ patterns: pattern, cwd, type }, context?.signal);
      if (files.length === 0) return '（无匹配文件）';
      const page = paginateItems(files.map((file) => file.path), offset, head_limit);
      const truncated = truncateText(page.items.join('\n'), max_chars);
      return appendPaginationNotice(truncated.text, page.nextOffset);
    } catch (e) {
      context?.signal?.throwIfAborted();
      if (e instanceof Error && e.message === 'glob_worker_heap_config') {
        return 'Error: glob_worker_heap_config; remove host V8 heap-size overrides or restart Desktop normally.';
      }
      return `Error: ${e instanceof Error ? e.message : 'glob_search_failed'}; narrow the search path or pattern.`;
    }
  },
};
