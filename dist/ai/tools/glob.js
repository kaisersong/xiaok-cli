import fg from 'fast-glob';
import { appendPaginationNotice, paginateItems, truncateText } from './truncation.js';
export const globTool = {
    permission: 'safe',
    definition: {
        name: 'glob',
        description: '按 glob 模式匹配文件，返回路径列表（按修改时间排序）',
        inputSchema: {
            type: 'object',
            properties: {
                pattern: { type: 'string', description: 'Glob 模式，如 **/*.ts' },
                path: { type: 'string', description: '搜索根目录（可选，默认当前目录）' },
                offset: { type: 'number', description: '分页偏移量（默认 0）' },
                head_limit: { type: 'number', description: '单次返回条数（默认 50）' },
                max_chars: { type: 'number', description: '输出字符上限（默认 12000）' },
            },
            required: ['pattern'],
        },
    },
    async execute(input) {
        const { pattern, path: cwd = process.cwd(), offset = 0, head_limit = 50, max_chars = 12_000, } = input;
        try {
            const files = await fg(pattern, { cwd, absolute: true, stats: true });
            files.sort((a, b) => (b.stats?.mtimeMs ?? 0) - (a.stats?.mtimeMs ?? 0));
            if (files.length === 0)
                return '（无匹配文件）';
            const page = paginateItems(files.map((file) => file.path), offset, head_limit);
            const truncated = truncateText(page.items.join('\n'), max_chars);
            return appendPaginationNotice(truncated.text, page.nextOffset);
        }
        catch (e) {
            return `Error: ${String(e)}`;
        }
    },
};
