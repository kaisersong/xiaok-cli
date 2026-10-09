import { resolve, sep, dirname, basename } from 'path';
import { realpathSync, lstatSync, readlinkSync } from 'fs';

export interface OutsideWorkspaceDecision {
  allowed: boolean;
  reason?: string;
}

/**
 * 允许访问工作区外路径时的二次检查（例如沙箱策略）。
 * 入参是规范化后的绝对路径（已 resolve）。
 */
export type OutsideWorkspaceGuard = (resolvedPath: string) => OutsideWorkspaceDecision;

const MAX_SYMLINK_HOPS = 40;

function normalizeForComparison(filePath: string): string {
  return process.platform === 'win32' ? filePath.toLowerCase() : filePath;
}

/**
 * 解析路径的真实位置：存在的部分用 realpath 解析符号链接；
 * 不存在的目标取最近的已存在父目录做 realpath 再拼回去；
 * 悬空的符号链接按其指向继续解析，避免借悬空链接写到别处。
 */
export function resolveRealPath(filePath: string, hops = 0): string {
  try {
    return realpathSync(filePath);
  } catch {
    if (hops < MAX_SYMLINK_HOPS) {
      try {
        if (lstatSync(filePath).isSymbolicLink()) {
          const target = readlinkSync(filePath);
          return resolveRealPath(resolve(dirname(filePath), target), hops + 1);
        }
      } catch {
        // 不存在或不可读：按父目录继续解析
      }
    }
    const parent = dirname(filePath);
    if (parent === filePath) return filePath;
    return resolve(resolveRealPath(parent, hops), basename(filePath));
  }
}

function isWithin(filePath: string, root: string): boolean {
  const normalizedPath = normalizeForComparison(filePath);
  const normalizedRoot = normalizeForComparison(root);
  const rootPrefix = normalizedRoot.endsWith(sep) ? normalizedRoot : `${normalizedRoot}${sep}`;
  return normalizedPath === normalizedRoot || normalizedPath.startsWith(rootPrefix);
}

/**
 * 校验工具要访问的路径：
 * - 先 resolve 规范化（消除 `.`/`..`），再按真实路径（解析符号链接后）判断是否仍在工作区内；
 * - 工作区内且真实位置也在工作区内 → 放行；
 * - 否则，只有 allowOutsideCwd 时才可能放行，且若提供了 outsideGuard（如沙箱策略）必须由它确认。
 */
export function assertWorkspacePath(
  filePath: string,
  cwd: string,
  mode: 'read' | 'write',
  allowOutsideCwd = false,
  outsideGuard?: OutsideWorkspaceGuard,
): string {
  const resolvedPath = resolve(filePath);
  const workspaceRoot = resolve(cwd);

  const lexicallyInside = isWithin(resolvedPath, workspaceRoot);
  const reallyInside = lexicallyInside && isWithin(resolveRealPath(resolvedPath), resolveRealPath(workspaceRoot));

  if (reallyInside) {
    return resolvedPath;
  }

  if (allowOutsideCwd) {
    if (outsideGuard) {
      const decision = outsideGuard(resolvedPath);
      if (!decision.allowed) {
        throw new Error(`Path denied by sandbox for ${mode}: ${filePath}${decision.reason ? ` (${decision.reason})` : ''}`);
      }
    }
    return resolvedPath;
  }

  if (!lexicallyInside) {
    throw new Error(`Path outside workspace for ${mode}: ${filePath}`);
  }
  throw new Error(`Symlink target outside workspace for ${mode}: ${filePath}`);
}
