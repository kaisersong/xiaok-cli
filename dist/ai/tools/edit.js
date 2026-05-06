import { readFileSync, writeFileSync, renameSync } from 'fs';
import { dirname, join, basename } from 'path';
import { assertWorkspacePath } from '../permissions/workspace.js';
/**
 * Generate a simple unified diff between two strings
 */
function generateUnifiedDiff(oldContent, newContent, filePath) {
    const oldLines = oldContent.split('\n');
    const newLines = newContent.split('\n');
    const lines = [];
    // Diff header
    const fileName = basename(filePath);
    lines.push(`diff --git a/${fileName} b/${fileName}`);
    lines.push(`--- a/${fileName}`);
    lines.push(`+++ b/${fileName}`);
    // Find changes - simple line-by-line comparison
    const maxLen = Math.max(oldLines.length, newLines.length);
    let hunkStart = -1;
    let hunkOldStart = 1;
    let hunkNewStart = 1;
    let hunkLines = [];
    for (let i = 0; i < maxLen; i++) {
        const oldLine = i < oldLines.length ? oldLines[i] : undefined;
        const newLine = i < newLines.length ? newLines[i] : undefined;
        if (oldLine !== newLine) {
            if (hunkStart === -1) {
                hunkStart = i;
                hunkOldStart = i + 1;
                hunkNewStart = i + 1;
                hunkLines = [];
            }
            if (oldLine !== undefined) {
                hunkLines.push(`-${oldLine}`);
            }
            if (newLine !== undefined) {
                hunkLines.push(`+${newLine}`);
            }
        }
        else if (hunkStart !== -1) {
            // Context line after changes
            hunkLines.push(` ${oldLine}`);
            // End hunk after 3 context lines
            if (hunkLines.length > 20) {
                const oldCount = hunkLines.filter(l => l.startsWith('-') || l.startsWith(' ')).length;
                const newCount = hunkLines.filter(l => l.startsWith('+') || l.startsWith(' ')).length;
                lines.push(`@@ -${hunkOldStart},${oldCount} +${hunkNewStart},${newCount} @@`);
                lines.push(...hunkLines);
                hunkStart = -1;
                hunkLines = [];
            }
        }
    }
    // Flush remaining hunk
    if (hunkLines.length > 0) {
        const oldCount = hunkLines.filter(l => l.startsWith('-') || l.startsWith(' ')).length;
        const newCount = hunkLines.filter(l => l.startsWith('+') || l.startsWith(' ')).length;
        lines.push(`@@ -${hunkOldStart},${oldCount} +${hunkNewStart},${newCount} @@`);
        lines.push(...hunkLines);
    }
    return lines.join('\n');
}
export function createEditTool(options = {}) {
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
            const { file_path, old_string, new_string } = input;
            const resolvedPath = assertWorkspacePath(file_path, cwd, 'write', allowOutsideCwd);
            let content;
            try {
                content = readFileSync(resolvedPath, 'utf-8');
            }
            catch {
                return `Error: 文件不存在: ${resolvedPath}`;
            }
            const occurrences = content.split(old_string).length - 1;
            if (occurrences === 0)
                return 'Error: old_string 在文件中不存在';
            if (occurrences > 1)
                return `Error: old_string 在文件中出现了 ${occurrences} 次，必须唯一`;
            const updated = content.split(old_string).join(new_string);
            // Generate unified diff before writing
            const diff = generateUnifiedDiff(content, updated, resolvedPath);
            const tmp = join(dirname(resolvedPath), `.xiaok-tmp-${Date.now()}`);
            writeFileSync(tmp, updated, 'utf-8');
            renameSync(tmp, resolvedPath);
            // Return diff + success message (DiffView can parse the diff header)
            return `${diff}\n\n已编辑: ${resolvedPath}`;
        },
    };
}
export const editTool = createEditTool();
