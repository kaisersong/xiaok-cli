import type { Tool } from '../../types.js';
import { type OutsideWorkspaceGuard } from '../permissions/workspace.js';
export interface WorkspaceToolOptions {
    cwd?: string;
    allowOutsideCwd?: boolean;
    /** allowOutsideCwd 时对工作区外（含符号链接指向区外）路径的二次检查，通常是沙箱策略。 */
    outsideCwdGuard?: OutsideWorkspaceGuard;
    artifactRoot?: string;
    /** Host-owned exact read-only references; never accepted from model input. */
    readOnlyPaths?: string[];
}
export declare function createReadTool(options?: WorkspaceToolOptions): Tool;
export declare const readTool: Tool;
