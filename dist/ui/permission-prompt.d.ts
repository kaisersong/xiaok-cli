import type { PermissionChoice } from '../types.js';
/** 从工具输入推导 glob 规则 */
export declare function deriveRule(toolName: string, input: Record<string, unknown>): string;
/**
 * 交互式权限确认选择器。
 * 显示工具信息 + 箭头键可选的多行选项列表。
 */
export declare function showPermissionPrompt(toolName: string, input: Record<string, unknown>): Promise<PermissionChoice>;
