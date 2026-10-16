import type { Tool } from '../../types.js';
export interface BashApprovalOptions {
    /** Live host authority; never derived from model tool input. */
    isYolo?: () => boolean;
}
export declare function createBashTool(options?: BashApprovalOptions): Tool;
export declare const bashTool: Tool;
/** Installed only by the interactive CLI host, before sandbox wrapping. */
export declare function createInteractiveBashTool(run: Tool['execute'], options?: BashApprovalOptions): Tool;
