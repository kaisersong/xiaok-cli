import type { Tool, ToolExecutionContext } from '../../types.js';
export type BashToolExecutionContext = Pick<ToolExecutionContext, 'signal' | 'assertPermissionApproval' | 'compoundPhase' | 'toolInvocationId' | 'runtimeFactSink' | 'observationCollector' | 'executionProgress'> | ToolExecutionContext;
export type BashTool = Omit<Tool, 'execute'> & {
    execute(input: Record<string, unknown>, context?: BashToolExecutionContext): Promise<string>;
};
export interface BashApprovalOptions {
    /** Live host mode callback; never model input. */
    isYolo?: () => boolean;
}
export declare function createBashTool(options?: BashApprovalOptions): BashTool;
export declare const bashTool: BashTool;
/** Installed only by the interactive CLI host, before sandbox wrapping. */
export declare function createInteractiveBashTool(run: Tool['execute'], options?: BashApprovalOptions): Tool;
