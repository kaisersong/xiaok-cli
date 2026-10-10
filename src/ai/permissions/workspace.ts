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
  if (filePath.includes('\0')) {
    throw new Error('path contains a NUL byte');
  }
  try {
    return realpathSync(filePath);
  } catch {
    let isSymlink = false;
    try {
      isSymlink = lstatSync(filePath).isSymbolicLink();
    } catch {
      // 不存在或不可读：按父目录继续解析
    }
    if (isSymlink) {
      if (hops >= MAX_SYMLINK_HOPS) {
        // 链接环或链过长：无法确定真实位置，按失败处理（调用方拒绝）
        throw new Error(`too many symbolic links: ${filePath}`);
      }
      return resolveRealPath(resolve(dirname(filePath), readlinkSync(filePath)), hops + 1);
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
 * - allowOutsideCwd 且提供了 outsideGuard（沙箱模式）：一律由 outsideGuard 判定（它负责规范化和真实路径解析）；
 * - 否则先 resolve 规范化（消除 `.`/`..`），再按真实路径（解析符号链接后）判断是否仍在工作区内；
 * - 不在工作区内时，只有 allowOutsideCwd 才放行。
 * 已知限制：检查与实际读写之间存在时间窗口（TOCTOU），硬链接不在 realpath 的识别范围内。
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

  if (allowOutsideCwd && outsideGuard) {
    // 沙箱模式：路径（不论是否在工作区内）都交给守卫判定，允许清单和拒绝清单都生效
    const decision = outsideGuard(resolvedPath);
    if (!decision.allowed) {
      throw new Error(`Path denied by sandbox for ${mode}: ${filePath}${decision.reason ? ` (${decision.reason})` : ''}`);
    }
    return resolvedPath;
  }

  const lexicallyInside = isWithin(resolvedPath, workspaceRoot);
  let reallyInside = false;
  if (lexicallyInside) {
    try {
      reallyInside = isWithin(resolveRealPath(resolvedPath), resolveRealPath(workspaceRoot));
    } catch {
      reallyInside = false;
    }
  }

  if (reallyInside) {
    return resolvedPath;
  }

  if (allowOutsideCwd) {
    return resolvedPath;
  }

  if (!lexicallyInside) {
    throw new Error(`Path outside workspace for ${mode}: ${filePath}`);
  }
  throw new Error(`Symlink target outside workspace for ${mode}: ${filePath}`);
}
