import type { StreamChunk, UsageStats } from '../../types.js';

export type AgentRuntimeEvent =
  | { type: 'run_started'; runId: string }
  | { type: 'assistant_text'; runId: string; delta: string }
  | { type: 'tool_started'; runId: string; toolName: string; input: Record<string, unknown> }
  | { type: 'tool_finished'; runId: string; toolName: string; ok: boolean }
  | { type: 'usage_updated'; runId: string; usage: UsageStats }
  | { type: 'compact_triggered'; runId: string; summary: string; compactionId?: string }
  | { type: 'max_iterations_reached'; runId: string; maxIterations: number; currentIteration: number }
  | { type: 'run_completed'; runId: string }
  | { type: 'run_failed'; runId: string; error: Error }
  | { type: 'run_aborted'; runId: string };

export function toLegacyStreamChunk(event: AgentRuntimeEvent): StreamChunk | null {
  if (event.type === 'assistant_text') {
    return { type: 'text', delta: event.delta };
  }

  if (event.type === 'usage_updated') {
    return { type: 'usage', usage: event.usage };
  }

  return null;
}
