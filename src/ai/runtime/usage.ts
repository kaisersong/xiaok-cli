import type { Message } from '../../types.js';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface UsageStats {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
}

export interface CompactionSummary {
  text: string;
  replacedMessages: number;
}

export interface ModelPricing {
  model: string;
  inputPer1M: number;
  outputPer1M: number;
  cacheCreationPer1M?: number;
  cacheReadPer1M?: number;
}

export type CostConfidence = 'estimated' | 'unknown';

const MODEL_ALIASES: Record<string, string> = {
  'claude-sonnet-4': 'claude-sonnet-4-20250514',
  'claude-opus-4': 'claude-opus-4-20250514',
  'gpt-4o': 'gpt-4o-2024-08-06',
};

let cachedPricingData: ModelPricing[] | undefined;

export function estimateTokens(messages: Message[]): number {
  let chars = 0;

  for (const message of messages) {
    for (const block of message.content) {
      if (block.type === 'text') chars += block.text.length;
      if (block.type === 'image') chars += Math.ceil(block.source.data.length / 8);
      if (block.type === 'thinking') chars += block.thinking.length;
      if (block.type === 'tool_use') chars += JSON.stringify(block.input).length;
      if (block.type === 'tool_result') chars += block.content.length;
    }
  }

  return Math.ceil(chars / 4);
}

export function shouldCompact(estimatedTokens: number, contextLimit: number, threshold = 0.85): boolean {
  return estimatedTokens > contextLimit * threshold;
}

export function mergeUsage(base: UsageStats, next: UsageStats): UsageStats {
  const merged: UsageStats = {
    inputTokens: next.inputTokens > 0 ? next.inputTokens : base.inputTokens,
    outputTokens: next.outputTokens > 0 ? next.outputTokens : base.outputTokens,
  };

  const cacheCreationInputTokens = next.cacheCreationInputTokens ?? base.cacheCreationInputTokens;
  if (cacheCreationInputTokens !== undefined) {
    merged.cacheCreationInputTokens = cacheCreationInputTokens;
  }

  const cacheReadInputTokens = next.cacheReadInputTokens ?? base.cacheReadInputTokens;
  if (cacheReadInputTokens !== undefined) {
    merged.cacheReadInputTokens = cacheReadInputTokens;
  }

  return merged;
}

export function computeCost(usage: UsageStats, model: string): number {
  const pricing = resolvePricing(model);
  if (!pricing) return 0;

  let cost = 0;
  cost += (usage.inputTokens / 1_000_000) * pricing.inputPer1M;
  cost += (usage.outputTokens / 1_000_000) * pricing.outputPer1M;
  if (usage.cacheCreationInputTokens !== undefined && pricing.cacheCreationPer1M !== undefined) {
    cost += (usage.cacheCreationInputTokens / 1_000_000) * pricing.cacheCreationPer1M;
  }
  if (usage.cacheReadInputTokens !== undefined && pricing.cacheReadPer1M !== undefined) {
    cost += (usage.cacheReadInputTokens / 1_000_000) * pricing.cacheReadPer1M;
  }
  return cost;
}

export function computeCostWithConfidence(
  usage: UsageStats,
  model: string,
): { cost: number; confidence: CostConfidence } {
  const pricing = resolvePricing(model);
  if (!pricing) {
    return { cost: 0, confidence: 'unknown' };
  }
  return { cost: computeCost(usage, model), confidence: 'estimated' };
}

function resolvePricing(model: string): ModelPricing | undefined {
  const canonical = MODEL_ALIASES[model] ?? model;
  const pricingData = getPricingData();
  const sorted = [...pricingData].sort((a, b) => b.model.length - a.model.length);
  return sorted.find((pricing) => (
    canonical === pricing.model ||
    canonical.startsWith(pricing.model) ||
    pricing.model.startsWith(canonical)
  ));
}

function getPricingData(): ModelPricing[] {
  if (cachedPricingData !== undefined) {
    return cachedPricingData;
  }

  for (const candidate of pricingCandidates()) {
    if (!existsSync(candidate)) {
      continue;
    }
    try {
      const parsed = JSON.parse(readFileSync(candidate, 'utf8')) as unknown;
      if (Array.isArray(parsed)) {
        cachedPricingData = parsed.filter(isModelPricing);
        return cachedPricingData;
      }
    } catch {
      continue;
    }
  }

  cachedPricingData = [];
  return cachedPricingData;
}

function pricingCandidates(): string[] {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  return [
    join(homedir(), '.xiaok', 'pricing.json'),
    join(moduleDir, '..', '..', '..', 'data', 'pricing.json'),
    join(process.cwd(), 'data', 'pricing.json'),
  ];
}

function isModelPricing(value: unknown): value is ModelPricing {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ModelPricing>;
  return (
    typeof candidate.model === 'string' &&
    typeof candidate.inputPer1M === 'number' &&
    typeof candidate.outputPer1M === 'number'
  );
}

function takeUnique(entries: string[], maxItems: number): string[] {
  const seen = new Set<string>();
  const results: string[] = [];
  for (const entry of entries) {
    const normalized = entry.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    results.push(normalized);
    if (results.length >= maxItems) break;
  }
  return results;
}

export function summarizeMessagesForCompaction(messages: Message[]): CompactionSummary {
  const rawUserIntents: string[] = [];
  const rawAssistantOutputs: string[] = [];
  const rawToolUses: string[] = [];

  for (const message of messages) {
    for (const block of message.content) {
      if (block.type === 'text' && message.role === 'user') {
        rawUserIntents.push(block.text);
      }
      if (block.type === 'text' && message.role === 'assistant') {
        rawAssistantOutputs.push(block.text);
      }
      if (block.type === 'tool_use') {
        rawToolUses.push(`${block.name}(${JSON.stringify(block.input)})`);
      }
    }
  }

  const userIntents = takeUnique(rawUserIntents, 3);
  const assistantOutputs = takeUnique(rawAssistantOutputs, 3);
  const toolUses = takeUnique(rawToolUses, 4);

  const lines = ['[context compacted summary]'];
  if (userIntents.length > 0) {
    lines.push(`user intents: ${userIntents.join(' | ')}`);
  }
  if (assistantOutputs.length > 0) {
    lines.push(`assistant outputs: ${assistantOutputs.join(' | ')}`);
  }
  if (toolUses.length > 0) {
    lines.push(`tool activity: ${toolUses.join(' | ')}`);
  }

  return {
    text: lines.join('\n'),
    replacedMessages: messages.length,
  };
}

export function compactMessages(
  messages: Message[],
  placeholder = '[context compacted]',
  keepRecent = 2,
): { messages: Message[]; summary: CompactionSummary } {
  if (messages.length <= keepRecent) {
    return {
      messages,
      summary: {
        text: placeholder,
        replacedMessages: 0,
      },
    };
  }

  // Find tool_use_ids in the recent messages that need corresponding tool_use messages
  const recentMessages = messages.slice(-keepRecent);
  const toolResultIds = new Set<string>();

  for (const msg of recentMessages) {
    // tool_result blocks are inside user messages (not separate 'tool' role messages)
    if (msg.role === 'user') {
      for (const block of msg.content) {
        if (block.type === 'tool_result') {
          toolResultIds.add(block.tool_use_id);
        }
      }
    }
  }

  // Find the earliest assistant message containing these tool_use_ids
  let additionalKeep = 0;
  if (toolResultIds.size > 0) {
    // Scan backwards from the cutoff point to find tool_use messages
    const cutoffIndex = messages.length - keepRecent;
    for (let i = cutoffIndex - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.role === 'assistant') {
        for (const block of msg.content) {
          if (block.type === 'tool_use' && toolResultIds.has(block.id)) {
            // Need to keep from this message onwards
            additionalKeep = cutoffIndex - i;
            break;
          }
        }
        if (additionalKeep > 0) break;
      }
    }
  }

  const actualKeepRecent = keepRecent + additionalKeep;
  const compactedMessages = messages.slice(0, -actualKeepRecent);
  const summary = summarizeMessagesForCompaction(compactedMessages);

  return {
    messages: [
      {
        role: 'user',
        content: [{ type: 'text', text: summary.text || placeholder }],
      },
      ...messages.slice(-actualKeepRecent),
    ],
    summary,
  };
}

const DEFAULT_TOOL_RESULT_LIMIT = 8000;

export interface TruncatedResult {
  content: string;
  spillPath?: string;
  hint?: string;
}

export function truncateToolResult(
  content: string,
  limit = DEFAULT_TOOL_RESULT_LIMIT,
  options?: { sessionId?: string; toolCallId?: string; spillDir?: string },
): TruncatedResult {
  if (content.length <= limit) return { content };

  // Try to spill to disk first
  if (options?.spillDir && options?.sessionId && options?.toolCallId) {
    // Sanitize: remove path traversal chars, keep only alphanumeric, dash, underscore
    const safeId = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
    const safeSessionId = safeId(options.sessionId) || 'unknown';
    const safeToolCallId = safeId(options.toolCallId) || 'unknown';
    const spillPath = join(options.spillDir, safeSessionId, `${safeToolCallId}.txt`);
    const relativeHint = `.xiaok/spill/${safeSessionId}/${safeToolCallId}.txt`;

    try {
      mkdirSync(dirname(spillPath), { recursive: true });
      writeFileSync(spillPath, content, 'utf-8');
      const kept = content.slice(0, limit);
      const omitted = content.length - limit;
      return {
        content: `${kept}\n...[truncated ${omitted} chars, 完整输出见 file://${relativeHint}]`,
        spillPath,
        hint: relativeHint,
      };
    } catch {
      // Fall back to pure truncation if spill fails
      const kept = content.slice(0, limit);
      const omitted = content.length - limit;
      return { content: `${kept}\n...[truncated ${omitted} chars]` };
    }
  }

  // Legacy behavior: pure truncation (no spill)
  const kept = content.slice(0, limit);
  const omitted = content.length - limit;
  return { content: `${kept}\n...[truncated ${omitted} chars]` };
}
