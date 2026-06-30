import { readFileSync, existsSync } from 'fs';
import { assertWorkspacePath } from '../permissions/workspace.js';
import { truncateText } from './truncation.js';
import { MODEL_OUTPUT_CAP, SENSITIVE_FILE_REDACTION, isSensitiveFilePath, redactSecrets, } from '../../shared/stream-safety/redact.js';
export function createReadTool(options = {}) {
    const cwd = options.cwd ?? process.cwd();
    const allowOutsideCwd = options.allowOutsideCwd ?? false;
    return {
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
                    max_chars: { type: 'number', description: '输出字符上限（默认 256KB）' },
                },
                required: ['file_path'],
            },
        },
        async execute(input) {
            const { file_path, offset = 1, limit, max_chars = MODEL_OUTPUT_CAP } = input;
            const resolvedPath = assertWorkspacePath(file_path, cwd, 'read', allowOutsideCwd);
            if (!existsSync(resolvedPath))
                return `Error: 文件不存在: ${resolvedPath}`;
            if (isSensitiveFilePath(resolvedPath)) {
                return SENSITIVE_FILE_REDACTION;
            }
            try {
                const lines = readFileSync(resolvedPath, 'utf-8').split('\n');
                const start = offset - 1;
                const slice = limit ? lines.slice(start, start + limit) : lines.slice(start);
                const numbered = slice.map((line, index) => `${start + index + 1}\t${line}`).join('\n');
                return truncateText(redactSecrets(numbered).text, max_chars).text;
            }
            catch (e) {
                return `Error: ${String(e)}`;
            }
        },
    };
}
export const readTool = createReadTool();
