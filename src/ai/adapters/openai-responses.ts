import type { ModelAdapter, Message, StreamChunk, ToolDefinition } from '../../types.js';

type ResponsesUsage = {
  input_tokens?: number;
  output_tokens?: number;
};

type ResponsesOutputItem =
  | { type: 'message'; content?: Array<{ type: string; text?: string }> }
  | { type: 'function_call'; call_id?: string; name?: string; arguments?: string };

type ResponsesResult = {
  output?: ResponsesOutputItem[];
  usage?: ResponsesUsage;
};

export class OpenAIResponsesAdapter implements ModelAdapter {
  private readonly apiKey: string;
  private readonly baseUrl?: string;
  private readonly defaultHeaders?: Record<string, string>;
  private model: string;

  constructor(
    apiKey: string,
    model = 'gpt-4.1',
    baseUrl?: string,
    defaultHeaders?: Record<string, string>,
  ) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.defaultHeaders = defaultHeaders;
    this.model = model;
  }

  getModelName(): string {
    return this.model;
  }

  cloneWithModel(model: string): OpenAIResponsesAdapter {
    return new OpenAIResponsesAdapter(this.apiKey, model, this.baseUrl, this.defaultHeaders);
  }

  async *stream(
    messages: Message[],
    tools: ToolDefinition[],
    systemPrompt: string,
  ): AsyncIterable<StreamChunk> {
    const endpoint = new URL('responses', ensureTrailingSlash(this.baseUrl)).toString();
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        ...(this.defaultHeaders ?? {}),
      },
      body: JSON.stringify({
        model: this.model,
        input: buildResponsesInput(messages, systemPrompt),
        tools: tools.length > 0
          ? tools.map((tool) => ({
              type: 'function',
              name: tool.name,
              description: tool.description,
              parameters: tool.inputSchema,
            }))
          : undefined,
      }),
    });

    if (!response.ok) {
      throw new Error(`${response.status} ${await response.text()}`);
    }

    const result = await response.json() as ResponsesResult;

    const textChunks: string[] = [];
    for (const item of result.output ?? []) {
      if (item.type === 'message') {
        for (const content of item.content ?? []) {
          if (content.type === 'output_text' && content.text) {
            textChunks.push(content.text);
          }
        }
        continue;
      }

      if (item.type === 'function_call') {
        let input: Record<string, unknown> = {};
        try {
          input = JSON.parse(item.arguments ?? '{}');
        } catch {
          input = { _raw: item.arguments ?? '' };
        }
        yield {
          type: 'tool_use',
          id: item.call_id ?? `${item.name ?? 'function'}_call`,
          name: item.name ?? 'function',
          input,
        };
      }
    }

    if (textChunks.length > 0) {
      yield { type: 'text', delta: textChunks.join('') };
    }

    yield {
      type: 'usage',
      usage: {
        inputTokens: result.usage?.input_tokens ?? 0,
        outputTokens: result.usage?.output_tokens ?? 0,
      },
    };
    yield { type: 'done' };
  }
}

function ensureTrailingSlash(baseUrl?: string): string {
  if (!baseUrl) {
    throw new Error('openai_responses 协议需要配置 baseUrl');
  }

  return baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
}

function buildResponsesInput(messages: Message[], systemPrompt: string): Array<Record<string, unknown>> {
  const items: Array<Record<string, unknown>> = [
    {
      role: 'system',
      content: [{ type: 'input_text', text: systemPrompt }],
    },
  ];

  for (const message of messages) {
    const content: Array<Record<string, unknown>> = [];
    for (const block of message.content) {
      if (block.type === 'text') {
        content.push({ type: 'input_text', text: block.text });
        continue;
      }
      if (block.type === 'tool_result') {
        content.push({
          type: 'input_text',
          text: block.content,
        });
      }
    }

    if (content.length > 0) {
      items.push({
        role: message.role,
        content,
      });
    }
  }

  return items;
}
