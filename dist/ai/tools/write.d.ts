import type { Tool, ToolExecutionContext } from '../../types.js';
import type { WorkspaceToolOptions } from './read.js';
export type WriteToolExecutionContext = Pick<ToolExecutionContext, 'signal' | 'assertPermissionApproval' | 'compoundPhase' | 'toolInvocationId' | 'runtimeFactSink'> | ToolExecutionContext;
export type WriteTool = Omit<Tool, 'execute'> & {
    execute(input: Record<string, unknown>, context?: WriteToolExecutionContext): Promise<string>;
};
export declare function createWriteTool(options?: WorkspaceToolOptions): WriteTool;
export declare const writeTool: WriteTool;
