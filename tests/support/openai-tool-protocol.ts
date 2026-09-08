export interface OpenAIToolProtocolMessage {
  role?: string;
  content?: unknown;
  tool_calls?: Array<{ id: string }>;
  tool_call_id?: string;
}

// Validate the provider wire contract, not the production fork implementation.
export function assertOpenAIToolProtocol(messages: readonly OpenAIToolProtocolMessage[]): void {
  const pending = new Set<string>();
  for (const message of messages) {
    if (message.role === 'tool') {
      if (!message.tool_call_id || !pending.delete(message.tool_call_id)) {
        throw new Error(`unexpected tool result: ${message.tool_call_id}`);
      }
      continue;
    }
    if (pending.size > 0) {
      throw new Error(`missing tool results before ${message.role}: ${[...pending].join(', ')}`);
    }
    if (message.role === 'assistant') {
      for (const call of message.tool_calls ?? []) {
        if (pending.has(call.id)) throw new Error(`duplicate tool call: ${call.id}`);
        pending.add(call.id);
      }
    }
  }
  if (pending.size > 0) throw new Error(`missing tool results at end: ${[...pending].join(', ')}`);
}
