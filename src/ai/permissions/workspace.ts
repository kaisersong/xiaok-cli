import { resolve, sep, dirname, basename } from 'path';
import { realpathSync, existsSync, lstatSync } from 'fs';

function normalizeForComparison(filePath: string): string {
  return process.platform === 'win32' ? filePath.toLowerCase() : filePath;
}

function resolveRealPath(filePath: string): string {
  try {
    return realpathSync(filePath);
  } catch {
    const parent = dirname(filePath);
    if (parent === filePath) return filePath;
    return resolve(resolveRealPath(parent), basename(filePath));
  }
}

function isSymlinkEscape(filePath: string, workspaceRoot: string): boolean {
  const realRoot = resolveRealPath(workspaceRoot);
  const realPath = resolveRealPath(filePath);
  const normalizedPath = normalizeForComparison(realPath);
  const normalizedRoot = normalizeForComparison(realRoot);
  const rootPrefix = normalizedRoot.endsWith(sep) ? normalizedRoot : `${normalizedRoot}${sep}`;
  return normalizedPath !== normalizedRoot && !normalizedPath.startsWith(rootPrefix);
}

export function assertWorkspacePath(
  filePath: string,
  cwd: string,
  mode: 'read' | 'write',
  allowOutsideCwd = false,
): string {
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

  if (mode === 'write' && isSymlinkEscape(resolvedPath, workspaceRoot)) {
    throw new Error(`Symlink target outside workspace for write: ${filePath}`);
  }

  return resolvedPath;
}
