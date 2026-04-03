import type { Message, ModelAdapter } from '../../types.js';

const NO_TOOLS_PREAMBLE = `CRITICAL: Respond with TEXT ONLY. Do NOT call any tools. Do NOT use any tool_use blocks.
Your task is to summarize the conversation below into a compact form that preserves all important context.
Include: key user requests, decisions made, files modified, tool results that matter, and current state.
Write in past tense. Be concise but complete.`;

export class CompactRunner {
  constructor(private readonly adapter: ModelAdapter) {}

  async run(messages: Message[]): Promise<string> {
    const summaryRequest: Message = {
      role: 'user',
      content: [{
        type: 'text',
        text: 'Please summarize the conversation above into a compact context summary.',
      }],
    };

    const chunks: string[] = [];
    for await (const chunk of this.adapter.stream(
      [...messages, summaryRequest],
      [], // no tools — enforced by NO_TOOLS_PREAMBLE
      NO_TOOLS_PREAMBLE,
    )) {
      if (chunk.type === 'text') chunks.push(chunk.delta);
    }

    return chunks.join('').trim();
  }
}
