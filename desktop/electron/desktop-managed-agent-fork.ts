import type { Message } from '../../src/types.js';
import { buildSynthesizedProviderContext, isStrictKimiK3Adapter, projectProviderPrivateMessages } from '../../src/ai/runtime/provider-private-projection.js';
import { completedForkMessages } from '../../src/ai/agents/completed-fork-messages.js';

export interface DesktopAgentFork {
  mode: 'none' | 'completed_prefix' | 'synthesized'; truncated: boolean; messages: Message[];
}

export function buildDesktopAgentFork(adapter: object, parent: readonly Message[], enabled: boolean): DesktopAgentFork {
  if (!enabled) return { mode: 'none', truncated: false, messages: [] };
  const complete = completedForkMessages(parent);
  if (!isStrictKimiK3Adapter(adapter)) return { mode: 'completed_prefix', truncated: complete.length !== parent.length, messages: structuredClone([...complete]) };
  // Use the existing strict schema/visibility projection, never stringify private
  // provider blocks or infer strictness from a caller-controlled model name.
  const visible = projectProviderPrivateMessages(complete);
  const envelope = buildSynthesizedProviderContext('subagent', visible);
  const records = (JSON.parse(envelope) as { records: Array<{ ordinal: number }> }).records;
  const firstVisible = visible.findIndex(message => message.content.length > 0);
  const truncated = complete.length !== parent.length || firstVisible >= 0 && (records.length === 0 || records[0].ordinal > firstVisible);
  return { mode: 'synthesized', truncated, messages: [{ role: 'user', content: [{ type: 'text', text: envelope }] }] };
}
