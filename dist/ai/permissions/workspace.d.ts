export interface OutsideWorkspaceDecision {
    allowed: boolean;
    reason?: string;
}
/**
 * 允许访问工作区外路径时的二次检查（例如沙箱策略）。
 * 入参是规范化后的绝对路径（已 resolve）。
 */
export type OutsideWorkspaceGuard = (resolvedPath: string) => OutsideWorkspaceDecision;
/**
 * 解析路径的真实位置：存在的部分用 realpath 解析符号链接；
 * 不存在的目标取最近的已存在父目录做 realpath 再拼回去；
 * 悬空的符号链接按其指向继续解析，避免借悬空链接写到别处。
 */
export declare function resolveRealPath(filePath: string, hops?: number): string;
/**
 * 校验工具要访问的路径：
 * - allowOutsideCwd 且提供了 outsideGuard（沙箱模式）：一律由 outsideGuard 判定（它负责规范化和真实路径解析）；
 * - 否则先 resolve 规范化（消除 `.`/`..`），再按真实路径（解析符号链接后）判断是否仍在工作区内；
 * - 不在工作区内时，只有 allowOutsideCwd 才放行。
 * 已知限制：检查与实际读写之间存在时间窗口（TOCTOU），硬链接不在 realpath 的识别范围内。
 */
export declare function assertWorkspacePath(filePath: string, cwd: string, mode: 'read' | 'write', allowOutsideCwd?: boolean, outsideGuard?: OutsideWorkspaceGuard): string;
