import type { PermissionChoice } from '../types.js';
import { type UiLocale } from './locale.js';
import type { TranscriptLogger } from './transcript.js';
import type { ReplRenderer } from './repl-renderer.js';
interface PromptRenderOption {
    label: string;
    selected: boolean;
}
export interface PermissionRequestPayload {
    toolName: string;
    summary: string;
    input: Record<string, unknown>;
    rule: string;
}
/** 从工具输入推导 glob 规则 */
export declare function deriveRule(toolName: string, input: Record<string, unknown>): string;
export declare function buildPermissionRequest(toolName: string, input: Record<string, unknown>): PermissionRequestPayload;
export declare function formatPermissionDecisionSummary(_choice: PermissionChoice): string;
export declare function formatPermissionPromptLines(toolName: string, input: Record<string, unknown>, options: PromptRenderOption[], locale?: UiLocale): string[];
/**
 * 交互式权限确认选择器。
 * 显示工具信息 + 箭头键可选的多行选项列表。
 */
export declare function showPermissionPrompt(toolName: string, input: Record<string, unknown>, config?: {
    transcriptLogger?: TranscriptLogger;
    renderer?: ReplRenderer;
}): Promise<PermissionChoice>;
export {};
