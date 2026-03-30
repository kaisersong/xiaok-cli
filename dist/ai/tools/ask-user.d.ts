import type { Tool } from '../../types.js';
export interface AskUserOptions {
    ask(question: string, placeholder?: string): Promise<string>;
}
export declare function createAskUserTool(options: AskUserOptions): Tool;
