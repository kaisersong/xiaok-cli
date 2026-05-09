/**
 * Context window management for desktop runner tool-use loops.
 *
 * Three layers of progressive compression:
 *   Layer 0 – Tool Result Budget: persist large results to disk
 *   Layer 1 – Thinking cleanup: strip old thinking blocks in API view
 *   Layer 2 – Auto-Compact: LLM-generated summary with boundary marker
 *
 * Plus a historySnip fallback when compact itself fails.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { Message, ModelAdapter } from '../../src/types.js';

// ---- Constants ----

const TOOL_RESULT_PERSIST_THRESHOLD = 30_000; // chars

const COMPACT_SUMMARY_PROMPT = `Summarize the conversation above into a structured summary. You MUST preserve:
1. The user's original task goal and specific requirements
2. ALL file paths that were created/modified/read (do NOT omit any)
3. Key technical decisions and parameter choices
4. Current progress: completed steps and next planned actions
5. Important findings or constraints

Format: markdown, within 2000 characters. Do not omit any file paths.`;

// ---- Layer 0: Tool Result Budget ----

export function maybePersistToolResult(
  result: string,
  toolName: string,
  toolUseId: string,
  sessionDir: string,
): { content: string; persisted: boolean } {
  if (result.length <= TOOL_RESULT_PERSIST_THRESHOLD || result.startsWith('Error')) {
    return { content: result, persisted: false };
  }
  try {
    const filePath = join(sessionDir, 'tool-results', `${toolUseId}.txt`);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, result, 'utf-8');
    const preview = buildToolResultPreview(result, toolName);
    return { content: preview, persisted: true };
  } catch {
    return { content: result.slice(0, TOOL_RESULT_PERSIST_THRESHOLD), persisted: false };
  }
}

export function buildToolResultPreview(result: string, toolName: string): string {
  const lines = result.split('\n');
  const lineCount = lines.length;
  const charCount = result.length;

  if (lineCount <= 30) {
    return `[Tool result persisted - ${toolName} - ${lineCount} lines, ${charCount} chars]\n${result}`;
  }

  const headLines = lines.slice(0, 20).join('\n');
  const tailLines = lines.slice(-10).join('\n');

  return [
    `[Tool result persisted - ${toolName} - ${lineCount} lines, ${charCount} chars]`,
    headLines,
    `\n... ${lineCount - 30} lines omitted ...\n`,
    tailLines,
    `[Full result saved to disk. Re-read original file if detailed content is needed.]`,
  ].join('\n');
}

// ---- Layer 1: Thinking Block Cleanup (view layer) ----

export function buildViewForAPI(
  messages: Message[],
  _keepRecentThinking: number = 2,
): Message[] {
  if (messages.length === 0) return [];

  const boundaryIdx = findLastCompactBoundary(messages);
  return messages.slice(boundaryIdx);
}

export function findLastCompactBoundary(messages: Message[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (
      msg.role === 'user' &&
      Array.isArray(msg.content) &&
      msg.content.some(
        (b: any) => b.type === 'text' && typeof b.text === 'string' && b.text.startsWith('[compact_boundary]'),
      )
    ) {
      return i;
    }
  }
  return 0;
}

// ---- Layer 2: Auto-Compact ----

export function shouldAutoCompact(lastInputTokens: number, contextLimit: number): boolean {
  const effectiveWindow = contextLimit - 20_000;
  const compactThreshold = effectiveWindow - 13_000;
  return lastInputTokens >= compactThreshold;
}

export async function compactConversation(
  messages: Message[],
  adapter: ModelAdapter,
  _systemPrompt: string,
): Promise<void> {
  const boundaryIdx = findLastCompactBoundary(messages);
  const messagesToSummarize = messages.slice(boundaryIdx);

  // Prepare messages: remove thinking, truncate large tool_results
  const compactMessages = prepareForCompact(messagesToSummarize);

  // Append compact prompt (merge into last user message to avoid consecutive user)
  const summaryMessages = appendCompactPrompt(compactMessages);

  // Use simplified system prompt to reduce token cost
  const compactSystemPrompt = 'You are a conversation summarizer. Compress the conversation history as requested.';
  let summary = '';
  try {
    for await (const chunk of adapter.stream(summaryMessages, [], compactSystemPrompt)) {
      if (chunk.type === 'text') summary += chunk.delta;
    }
  } catch {
    // Fallback: if summary request fails (e.g. prompt_too_long), do history snip
    historySnip(messages, 6);
    return;
  }

  if (!summary.trim()) return;

  // Insert compact_boundary — ensure strict user/assistant alternation
  const lastRole = messages[messages.length - 1]?.role;
  if (lastRole === 'user') {
    messages.push({
      role: 'assistant',
      content: [{ type: 'text', text: '[context compacted]' }],
    });
  }
  messages.push({
    role: 'user',
    content: [{ type: 'text', text: `[compact_boundary]\n\n${summary}` }],
  });
  messages.push({
    role: 'assistant',
    content: [{ type: 'text', text: 'Understood, I have the context from the summary above. Continuing the task.' }],
  });
}

/** Strip thinking blocks and truncate large tool_results to keep compact request small */
export function prepareForCompact(messages: Message[]): Message[] {
  return messages.map(msg => ({
    role: msg.role,
    content: Array.isArray(msg.content)
      ? msg.content
          .filter((b: any) => b.type !== 'thinking')
          .map((b: any) => {
            if (b.type === 'tool_result' && typeof b.content === 'string' && b.content.length > 5000) {
              return { ...b, content: b.content.slice(0, 2000) + '\n[...truncated]' };
            }
            return b;
          })
      : msg.content,
  }));
}

/** Merge COMPACT_SUMMARY_PROMPT into the last user message to avoid consecutive user messages */
export function appendCompactPrompt(messages: Message[]): Message[] {
  const result = [...messages];
  const lastIdx = result.length - 1;
  if (lastIdx >= 0 && result[lastIdx].role === 'user') {
    result[lastIdx] = {
      role: 'user',
      content: [
        ...(Array.isArray(result[lastIdx].content) ? result[lastIdx].content : []),
        { type: 'text', text: '\n\n' + COMPACT_SUMMARY_PROMPT },
      ],
    };
  } else {
    result.push({
      role: 'user',
      content: [{ type: 'text', text: COMPACT_SUMMARY_PROMPT }],
    });
  }
  return result;
}

/** Cheap fallback: remove oldest message pairs after the boundary */
export function historySnip(messages: Message[], removeGroups: number): void {
  const boundaryIdx = findLastCompactBoundary(messages);
  // Start after boundary (+ dummy assistant if present)
  let startIdx = boundaryIdx === 0 ? 1 : boundaryIdx + 2;
  let removed = 0;
  const targetRemove = removeGroups * 2; // each group = user + assistant pair
  while (removed < targetRemove && startIdx < messages.length - 4) {
    messages.splice(startIdx, 1);
    removed++;
  }
}

// ---- Context Limit Detection ----

export function getContextLimit(modelName: string): number {
  const name = modelName.toLowerCase();
  if (name.includes('opus')) return 1_000_000;
  if (name.includes('claude')) return 200_000;
  if (name.includes('deepseek')) return 64_000;
  if (name.includes('gpt-4o')) return 128_000;
  if (name.includes('gpt-4')) return 128_000;
  if (name.includes('o1') || name.includes('o3') || name.includes('o4')) return 200_000;
  return 128_000; // conservative default
}

export { TOOL_RESULT_PERSIST_THRESHOLD, COMPACT_SUMMARY_PROMPT };
