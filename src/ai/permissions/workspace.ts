import { resolve, sep } from 'path';

function normalizeForComparison(filePath: string): string {
  return process.platform === 'win32' ? filePath.toLowerCase() : filePath;
}

export function assertWorkspacePath(
  filePath: string,
  cwd: string,
  mode: 'read' | 'write',
  allowOutsideCwd = false,
): string {
  const resolvedPath = resolve(cwd, filePath);
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
