import { readFileSync, existsSync, openSync, readSync, closeSync } from 'fs';
import { extname } from 'path';
import { assertWorkspacePath } from '../permissions/workspace.js';
import { truncateText } from './truncation.js';
import { extractMaterialText } from '../../runtime/materials/text-extractor.js';
import { MODEL_OUTPUT_CAP, SENSITIVE_FILE_REDACTION, isSensitiveFilePath, redactSecrets, } from '../../shared/stream-safety/redact.js';
const OOXML_EXTENSIONS = new Set(['.docx', '.pptx', '.xlsx']);
const HEADER_SNIFF_BYTES = 4096;
/**
 * Extraction ceiling for Office documents. Deliberately far above the
 * extractor's own 50K default so that a line `offset` past that default still
 * lands on real content; still bounded so a pathological file cannot make the
 * tool do unbounded work.
 */
const OFFICE_EXTRACTION_CAP = 2_000_000;
function readHeader(path) {
    const handle = openSync(path, 'r');
    try {
        const header = Buffer.alloc(HEADER_SNIFF_BYTES);
        const bytesRead = readSync(handle, header, 0, HEADER_SNIFF_BYTES, 0);
        return header.subarray(0, bytesRead);
    }
    finally {
        closeSync(handle);
    }
}
function classifyReadContent(path, header) {
    // Office extensions go to the extractor even when the bytes are not a ZIP:
    // it recognises a legacy .xls renamed to .xlsx and says so.
    if (OOXML_EXTENSIONS.has(extname(path).toLowerCase()))
        return 'ooxml';
    if (header.subarray(0, 5).toString('latin1') === '%PDF-')
        return 'pdf';
    if (header.includes(0))
        return 'binary';
    return 'text';
}
export function createReadTool(options = {}) {
    const cwd = options.cwd ?? process.cwd();
    const allowOutsideCwd = options.allowOutsideCwd ?? false;
    return {
        permission: 'safe',
        definition: {
            name: 'read',
            description: '读取文件内容，带行号输出。Office 文档（docx/pptx/xlsx）会自动提取文本',
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
                const kind = classifyReadContent(resolvedPath, readHeader(resolvedPath));
                if (kind === 'pdf') {
                    return 'Error: 无法以文本方式读取 PDF。请把它作为附件交给 Desktop 的 read_material，或先转换为文本。';
                }
                if (kind === 'binary') {
                    return `Error: 这是二进制文件，无法以文本方式读取: ${resolvedPath}`;
                }
                let content;
                if (kind === 'ooxml') {
                    const extraction = await extractMaterialText({
                        workspacePath: resolvedPath,
                        mimeType: '',
                        maxChars: OFFICE_EXTRACTION_CAP,
                    });
                    if (extraction.parseStatus !== 'parsed' || !extraction.text) {
                        return `Error: ${extraction.errorMessage ?? '未能从该 Office 文档提取到可读正文'}`;
                    }
                    content = extraction.text;
                }
                else {
                    content = readFileSync(resolvedPath, 'utf-8');
                }
                const lines = content.split('\n');
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
