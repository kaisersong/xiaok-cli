/**
 * Interactive question prompt — CC-style AskUserQuestion for the terminal.
 *
 * Renders:
 *   - Header chip + question text
 *   - Numbered option list with ❯ highlight (left column)
 *   - Optional preview panel (right column, shown when focused option has preview)
 *   - Multi-select support (Space to toggle, Enter to confirm)
 *   - "Other" free-text input option always appended
 *
 * Usage:
 *   const answer = await askQuestion({
 *     header: 'Auth method',
 *     question: 'Which auth method?',
 *     options: [
 *       { label: 'JWT', description: 'Stateless tokens', preview: '```ts\njwt.sign()\n```' },
 *       { label: 'Session', description: 'Server-side sessions' },
 *     ],
 *     multiSelect: false,
 *   });
 */
export interface AskOption {
    label: string;
    description?: string;
    preview?: string;
}
export interface AskQuestionParams {
    header?: string;
    question: string;
    options: AskOption[];
    multiSelect?: boolean;
}
export interface AskQuestionResult {
    selected: number[];
    labels: string[];
    otherText?: string;
}
export declare function askQuestion(params: AskQuestionParams): Promise<AskQuestionResult>;
