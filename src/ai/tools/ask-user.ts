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

export function createAskUserTool(options: AskUserOptions): Tool {
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
          multiSelect: { type: 'boolean', description: '有选项时是否允许多选（可选）' },
          options: {
            type: 'array',
            description: '供用户选择的选项；需要选择题时提供 2-4 项',
            items: {
              type: 'object',
              properties: {
                label: { type: 'string', description: '选项名称' },
                description: { type: 'string', description: '选项说明（可选）' },
                preview: { type: 'string', description: '选中时展示的 Markdown 预览（可选）' },
              },
              required: ['label'],
            },
          },
        },
        required: ['question'],
      },
    },
    async execute(input) {
      const question = typeof input.question === 'string' ? input.question.trim() : '';
      const placeholder = typeof input.placeholder === 'string' ? input.placeholder : undefined;
      const choices = Array.isArray(input.options)
        ? input.options.flatMap((option) => {
          if (!option || typeof option !== 'object') return [];
          const candidate = option as Record<string, unknown>;
          const label = typeof candidate.label === 'string' ? candidate.label.trim() : '';
          if (!label) return [];
          return [{
            label,
            description: typeof candidate.description === 'string' ? candidate.description : undefined,
            preview: typeof candidate.preview === 'string' ? candidate.preview : undefined,
          }];
        })
        : [];
      if (!question) {
        return 'Error: question 不能为空';
      }

      try {
        return await options.ask(
          question,
          placeholder,
          choices.length > 0
            ? { options: choices, multiSelect: input.multiSelect === true }
            : undefined,
        );
      } catch (error) {
        return `Error: ${String(error)}`;
      }
    },
  };
}
