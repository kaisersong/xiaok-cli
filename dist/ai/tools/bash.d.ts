import type { Tool, ToolExecutionContext } from '../../types.js';
export type BashToolExecutionContext = Pick<ToolExecutionContext, 'signal' | 'assertPermissionApproval' | 'compoundPhase' | 'toolInvocationId' | 'runtimeFactSink' | 'observationCollector' | 'executionProgress'> | ToolExecutionContext;
export type BashTool = Omit<Tool, 'execute'> & {
    execute(input: Record<string, unknown>, context?: BashToolExecutionContext): Promise<string>;
};
export declare const bashTool: BashTool;
/** Installed only by the interactive CLI host, before sandbox wrapping. */
export declare function createInteractiveBashTool(run: Tool['execute']): Tool;
