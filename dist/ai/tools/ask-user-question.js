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
            description: 'Ask the user one or more multiple-choice questions to gather information, clarify ambiguity, or offer choices. Use when you need structured input rather than free-form text.',
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
