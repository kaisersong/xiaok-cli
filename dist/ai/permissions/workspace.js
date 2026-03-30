import { resolve, sep } from 'path';
function normalizeForComparison(filePath) {
    return process.platform === 'win32' ? filePath.toLowerCase() : filePath;
}
export function assertWorkspacePath(filePath, cwd, mode, allowOutsideCwd = false) {
    // 对于绝对路径，直接使用；对于相对路径，相对于 cwd 解析
    const resolvedPath = resolve(filePath);
    if (allowOutsideCwd) {
        return resolvedPath;
    }
    const workspaceRoot = resolve(cwd);
    const normalizedPath = normalizeForComparison(resolvedPath);
    const normalizedRoot = normalizeForComparison(workspaceRoot);
    const rootPrefix = normalizedRoot.endsWith(sep) ? normalizedRoot : `${normalizedRoot}${sep}`;
    if (normalizedPath !== normalizedRoot && !normalizedPath.startsWith(rootPrefix)) {
        throw new Error(`Path outside workspace for ${mode}: ${filePath}`);
    }
    return resolvedPath;
}
