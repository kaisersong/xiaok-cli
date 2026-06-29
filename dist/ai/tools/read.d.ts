import type { Tool } from '../../types.js';
export interface WorkspaceToolOptions {
    cwd?: string;
    allowOutsideCwd?: boolean;
    artifactRoot?: string;
}
export declare function createReadTool(options?: WorkspaceToolOptions): Tool;
export declare const readTool: Tool;
