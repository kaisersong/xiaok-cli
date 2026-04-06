/**
 * AskUserQuestion tool — CC-compatible interactive multi-choice prompt.
 * The AI calls this tool to present the user with a structured question
 * and get back their selection.
 */
import { askQuestion } from '../../ui/ask-question.js';
export function createAskUserQuestionTool() {
    return {
        permission: 'safe',
        definition: {
            name: 'AskUserQuestion',
            description: `Use this tool when you need to ask the user questions during execution. This allows you to:
1. Gather user preferences or requirements
2. Clarify ambiguous instructions
3. Get decisions on implementation choices as you work
4. Offer choices to the user about what direction to take.

Usage notes:
- Users will always be able to select "Other" to provide custom text input
- Use multiSelect: true to allow multiple answers to be selected for a question
- If you recommend a specific option, make that the first option in the list and add "(Recommended)" at the end of the label

IMPORTANT: Do NOT use this tool as a first response to friction or minor obstacles. Only use it when you are genuinely stuck after investigation — not before trying reasonable approaches. The user expects you to solve problems autonomously; asking unnecessary questions disrupts their workflow.`,
            inputSchema: {
                type: 'object',
                properties: {
                    questions: {
                        type: 'array',
                        description: 'List of questions to ask (1-4)',
                        items: {
                            type: 'object',
                            properties: {
                                header: { type: 'string', description: 'Short chip label (max 12 chars)' },
                                question: { type: 'string', description: 'The question text' },
                                multiSelect: { type: 'boolean', description: 'Allow multiple selections' },
                                options: {
                                    type: 'array',
                                    description: '2-4 options',
                                    items: {
                                        type: 'object',
                                        properties: {
                                            label: { type: 'string' },
                                            description: { type: 'string' },
                                            preview: { type: 'string', description: 'Optional preview content (markdown/code)' },
                                        },
                                        required: ['label'],
                                    },
                                },
                            },
                            required: ['question', 'options'],
                        },
                    },
                },
                required: ['questions'],
            },
        },
        async execute(input) {
            const questions = input.questions;
            if (!Array.isArray(questions) || questions.length === 0) {
                return 'Error: questions 不能为空';
            }
            const answers = {};
            for (const q of questions.slice(0, 4)) {
                if (!q.question || !Array.isArray(q.options) || q.options.length < 2)
                    continue;
                const result = await askQuestion({
                    header: q.header,
                    question: q.question,
                    options: q.options,
                    multiSelect: q.multiSelect ?? false,
                });
                const answerText = result.otherText
                    ? result.otherText
                    : result.labels.join(', ');
                answers[q.question] = answerText;
            }
            return JSON.stringify({ answers });
        },
    };
}
