import { assertCompoundFileEffectCurrent } from '../../runtime/sol-pi/compound-native-phase.js';
import { writeFileAtomicallySync } from '../../utils/atomic-file.js';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'fs';
import { dirname, join } from 'path';
import { assertWorkspacePath } from '../permissions/workspace.js';
export function createWriteTool(options = {}) {
    const cwd = options.cwd ?? process.cwd();
    const allowOutsideCwd = options.allowOutsideCwd ?? false;
    return {
        permission: 'write',
        compoundFilePrecondition(input) {
            const filePath = assertWorkspacePath(String(input.file_path ?? ''), cwd, 'write', allowOutsideCwd);
            let beforeHash = null;
            try {
                beforeHash = createHash('sha256').update(readFileSync(filePath)).digest('hex');
            }
            catch (error) {
                if (error.code !== 'ENOENT')
                    throw error;
            }
            return { filePath, beforeHash };
        },
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
        async execute(input, context) {
            const { file_path, content } = input;
            const resolvedPath = assertWorkspacePath(file_path, cwd, 'write', allowOutsideCwd);
            if (context?.compoundPhase) {
                let beforeHash = null;
                try {
                    beforeHash = createHash('sha256').update(readFileSync(resolvedPath)).digest('hex');
                }
                catch (error) {
                    if (error.code !== 'ENOENT')
                        throw error;
                }
                await context.compoundPhase.beforeFileMutation?.({ filePath: resolvedPath, beforeHash, afterHash: createHash('sha256').update(content, 'utf8').digest('hex') });
                let currentHash = null;
                try {
                    currentHash = createHash('sha256').update(readFileSync(resolvedPath)).digest('hex');
                }
                catch (error) {
                    if (error.code !== 'ENOENT')
                        throw error;
                }
                if (currentHash !== beforeHash)
                    throw Error('compound_file_changed_before_mutation');
            }
            context?.signal?.throwIfAborted();
            context?.assertPermissionApproval?.();
            assertCompoundFileEffectCurrent(context?.compoundPhase);
            if (context?.compoundPhase)
                writeFileAtomicallySync(resolvedPath, content, { requireDirectorySync: true, tempName: `.xiaok-tmp-${randomUUID()}` });
            else {
                mkdirSync(dirname(resolvedPath), { recursive: true });
                const tmp = join(dirname(resolvedPath), `.xiaok-tmp-${Date.now()}`);
                writeFileSync(tmp, content, 'utf-8');
                renameSync(tmp, resolvedPath);
            }
            await context?.compoundPhase?.fileMutationCommitted?.({ filePath: resolvedPath, afterHash: createHash('sha256').update(content, 'utf8').digest('hex') });
            if (context?.toolInvocationId) {
                context.runtimeFactSink?.emit({
                    invocationId: context.toolInvocationId,
                    toolName: 'write',
                    factKind: 'file_mutation',
                    normalizedFilePaths: [resolvedPath],
                });
            }
            return `已写入: ${resolvedPath}（${content.length} 字符）`;
        },
    };
}
export const writeTool = createWriteTool();
