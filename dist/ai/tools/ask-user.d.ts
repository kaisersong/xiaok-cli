import type { Tool } from '../../types.js';
export interface AskUserChoice {
    label: string;
    description?: string;
    preview?: string;
}
export interface AskUserInteraction {
    options: AskUserChoice[];
    multiSelect?: boolean;
}
export interface AskUserOptions {
    ask(question: string, placeholder?: string, interaction?: AskUserInteraction): Promise<string>;
}
export declare function createAskUserTool(options: AskUserOptions): Tool;
