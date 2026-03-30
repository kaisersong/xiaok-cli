export function createAskUserTool(options) {
    return {
        permission: 'safe',
        definition: {
            name: 'ask_user',
            description: '向当前操作者提一个问题，并等待回答后继续执行',
            inputSchema: {
                type: 'object',
                properties: {
                    question: { type: 'string', description: '要向用户展示的问题' },
                    placeholder: { type: 'string', description: '输入提示或建议回答格式（可选）' },
                },
                required: ['question'],
            },
        },
        async execute(input) {
            const question = typeof input.question === 'string' ? input.question.trim() : '';
            const placeholder = typeof input.placeholder === 'string' ? input.placeholder : undefined;
            if (!question) {
                return 'Error: question 不能为空';
            }
            try {
                return await options.ask(question, placeholder);
            }
            catch (error) {
                return `Error: ${String(error)}`;
            }
        },
    };
}
