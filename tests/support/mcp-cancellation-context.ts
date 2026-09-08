import type { ToolExecutionContext } from '../../src/types.js';
import { AgentSessionState } from '../../src/ai/runtime/session.js';

/** Data fixture only: no adapter, signal racing, or cancellation logic. */
export function mcpTestContext(signal: AbortSignal, overrides: Partial<ToolExecutionContext> = {}): ToolExecutionContext {
  return { taskId: 'mcp-cancellation-fixture', session: new AgentSessionState().exportSnapshot(), messages: [], systemPrompt: 'fixture', toolDefinitions: [], signal, ...overrides };
}
