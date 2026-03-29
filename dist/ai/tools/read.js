import { readFileSync, existsSync } from 'fs';
export const readTool = {
    permission: 'safe',
    definition: {
        name: 'read',
        description: '读取文件内容，带行号输出',
        inputSchema: {
            type: 'object',
            properties: {
                file_path: { type: 'string', description: '文件绝对路径' },
                offset: { type: 'number', description: '起始行号（1-based，可选）' },
                limit: { type: 'number', description: '最多读取行数（可选）' },
            },
            required: ['file_path'],
        },
    },
    async execute(input) {
        const { file_path, offset = 1, limit } = input;
        if (!existsSync(file_path))
            return `Error: 文件不存在: ${file_path}`;
        try {
            const lines = readFileSync(file_path, 'utf-8').split('\n');
            const start = offset - 1;
            const slice = limit ? lines.slice(start, start + limit) : lines.slice(start);
            return slice.map((l, i) => `${start + i + 1}\t${l}`).join('\n');
        }
        catch (e) {
            return `Error: ${String(e)}`;
        }
    },
};
