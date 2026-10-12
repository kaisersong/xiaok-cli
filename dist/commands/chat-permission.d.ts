import type { PermissionChoice } from '../types.js';
type TerminalDecide = (name: string, input: Record<string, unknown>, signal?: AbortSignal) => Promise<boolean>;
/** 双端决定完成后，才保存获胜终端选择的规则。 */
export declare function confirmChatPermission(name: string, input: Record<string, unknown>, options: {
    prompt: (name: string, input: Record<string, unknown>, signal?: AbortSignal) => Promise<PermissionChoice>;
    race?: (terminal: TerminalDecide) => Promise<boolean>;
    addAllowRule: (scope: 'project' | 'global', rule: string) => Promise<void>;
    addSessionRule: (rule: string) => void;
}): Promise<boolean>;
export {};
