/**
 * AskUserQuestion tool — CC-compatible interactive multi-choice prompt.
 * The AI calls this tool to present the user with a structured question
 * and get back their selection.
 */
import type { Tool } from '../../types.js';
export interface AskUserQuestionToolOptions {
    onEnterInteractive?: () => void;
    onExitInteractive?: () => void;
}
export declare function createAskUserQuestionTool(options?: AskUserQuestionToolOptions): Tool;
