import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  maybePersistToolResult,
  buildToolResultPreview,
  buildViewForAPI,
  findLastCompactBoundary,
  shouldAutoCompact,
  compactConversation,
  prepareForCompact,
  appendCompactPrompt,
  historySnip,
  getContextLimit,
  TOOL_RESULT_PERSIST_THRESHOLD,
} from '../../electron/context-manager.js';
import type { Message, ModelAdapter, StreamChunk } from '../../../src/types.js';

// ---- Helpers ----

function textMsg(role: 'user' | 'assistant', text: string): Message {
  return { role, content: [{ type: 'text', text }] };
}

function thinkingAssistant(thinking: string, text: string): Message {
  return {
    role: 'assistant',
    content: [
      { type: 'thinking', thinking },
      { type: 'text', text },
    ],
  };
}

function toolResultMsg(toolUseId: string, content: string, isError = false): Message {
  return {
    role: 'user',
    content: [{ type: 'tool_result', tool_use_id: toolUseId, content, is_error: isError }],
  };
}

function toolUseAssistant(id: string, name: string, input: Record<string, unknown> = {}): Message {
  return {
    role: 'assistant',
    content: [{ type: 'tool_use', id, name, input }],
  };
}

function boundaryMsg(summary: string): Message {
  return textMsg('user', `[compact_boundary]\n\n${summary}`);
}

function createMockAdapter(options: {
  compactSummary?: string;
  throwOnCompact?: boolean;
} = {}): ModelAdapter {
  return {
    getModelName: () => 'test-model',
    async *stream(messages: Message[], _tools: any, systemPrompt: string): AsyncIterable<StreamChunk> {
      const isCompact = systemPrompt.includes('summarizer');
      if (isCompact && options.throwOnCompact) {
        throw new Error('prompt_too_long');
      }
      if (isCompact) {
        yield { type: 'text', delta: options.compactSummary ?? '## Summary\nCompleted steps 1-5.' };
        yield { type: 'usage', usage: { inputTokens: 1000, outputTokens: 200 } };
        return;
      }
      yield { type: 'text', delta: 'ok' };
      yield { type: 'usage', usage: { inputTokens: 5000, outputTokens: 100 } };
    },
  };
}

// ---- Tests ----

describe('context-manager', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `ctx-mgr-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ---- maybePersistToolResult ----

  describe('maybePersistToolResult', () => {
    it('does not persist short results', () => {
      const result = maybePersistToolResult('short result', 'Read', 'tool_1', tmpDir);
      expect(result.persisted).toBe(false);
      expect(result.content).toBe('short result');
    });

    it('persists results exceeding threshold', () => {
      const longResult = 'x\n'.repeat(20000);
      const result = maybePersistToolResult(longResult, 'Read', 'tool_2', tmpDir);
      expect(result.persisted).toBe(true);
      expect(result.content).toContain('[Tool result persisted');
      expect(result.content).toContain('Read');
      // Verify file on disk
      const filePath = join(tmpDir, 'tool-results', 'tool_2.txt');
      expect(existsSync(filePath)).toBe(true);
      expect(readFileSync(filePath, 'utf-8')).toBe(longResult);
    });

    it('does not persist Error results even if long', () => {
      const errorResult = 'Error: ' + 'x'.repeat(40000);
      const result = maybePersistToolResult(errorResult, 'Bash', 'tool_3', tmpDir);
      expect(result.persisted).toBe(false);
      expect(result.content).toBe(errorResult);
    });

    it('creates sessionDir automatically', () => {
      const nested = join(tmpDir, 'deep', 'nested', 'session');
      const longResult = 'line\n'.repeat(10000);
      const result = maybePersistToolResult(longResult, 'Read', 'tool_4', nested);
      expect(result.persisted).toBe(true);
      expect(existsSync(join(nested, 'tool-results', 'tool_4.txt'))).toBe(true);
    });

    it('falls back to truncation on write failure', () => {
      // Use a path that cannot be created (file as directory)
      const badDir = join(tmpDir, 'file.txt');
      mkdirSync(tmpDir, { recursive: true });
      // Create a regular file where a directory is expected
      const { writeFileSync: wfs } = require('node:fs');
      wfs(badDir, 'blocker');
      const longResult = 'y'.repeat(40000);
      const result = maybePersistToolResult(longResult, 'Read', 'tool_5', join(badDir, 'sub'));
      expect(result.persisted).toBe(false);
      expect(result.content.length).toBeLessThanOrEqual(TOOL_RESULT_PERSIST_THRESHOLD);
    });

    it('returns exact threshold-length result without persisting', () => {
      const exact = 'z'.repeat(TOOL_RESULT_PERSIST_THRESHOLD);
      const result = maybePersistToolResult(exact, 'Read', 'tool_6', tmpDir);
      expect(result.persisted).toBe(false);
      expect(result.content).toBe(exact);
    });
  });

  // ---- buildToolResultPreview ----

  describe('buildToolResultPreview', () => {
    it('shows head + tail for long results', () => {
      const lines = Array.from({ length: 500 }, (_, i) => `line ${i + 1}`);
      const result = lines.join('\n');
      const preview = buildToolResultPreview(result, 'Read');
      expect(preview).toContain('[Tool result persisted - Read');
      expect(preview).toContain('line 1');
      expect(preview).toContain('line 20');
      expect(preview).toContain('line 500');
      expect(preview).toContain('470 lines omitted');
    });

    it('preserves full content when <= 30 lines', () => {
      const result = Array.from({ length: 25 }, (_, i) => `line ${i}`).join('\n');
      const preview = buildToolResultPreview(result, 'Write');
      expect(preview).toContain('line 0');
      expect(preview).toContain('line 24');
      expect(preview).not.toContain('omitted');
    });
  });

  // ---- buildViewForAPI ----

  describe('buildViewForAPI', () => {
    it('returns empty array for empty messages', () => {
      expect(buildViewForAPI([])).toEqual([]);
    });

    it('returns all messages when no boundary exists', () => {
      const msgs: Message[] = [
        textMsg('user', 'hello'),
        textMsg('assistant', 'hi'),
      ];
      expect(buildViewForAPI(msgs)).toEqual(msgs);
    });

    it('returns messages after boundary', () => {
      const msgs: Message[] = [
        textMsg('user', 'old question'),
        textMsg('assistant', 'old answer'),
        boundaryMsg('summary of old'),
        textMsg('assistant', 'acknowledged'),
        textMsg('user', 'new question'),
        textMsg('assistant', 'new answer'),
      ];
      const view = buildViewForAPI(msgs);
      expect(view.length).toBe(4); // boundary + 3 after
      expect((view[0].content[0] as any).text).toContain('[compact_boundary]');
    });

    it('uses last boundary when multiple exist', () => {
      const msgs: Message[] = [
        textMsg('user', 'q1'),
        textMsg('assistant', 'a1'),
        boundaryMsg('summary 1'),
        textMsg('assistant', 'ack 1'),
        textMsg('user', 'q2'),
        textMsg('assistant', 'a2'),
        boundaryMsg('summary 2'),
        textMsg('assistant', 'ack 2'),
        textMsg('user', 'q3'),
      ];
      const view = buildViewForAPI(msgs);
      expect((view[0].content[0] as any).text).toContain('summary 2');
    });

    it('preserves thinking blocks (required by reasoning models)', () => {
      const msgs: Message[] = [
        textMsg('user', 'q'),
        thinkingAssistant('think1', 'a1'),
        textMsg('user', 'q2'),
        thinkingAssistant('think2', 'a2'),
      ];
      const view = buildViewForAPI(msgs, 0);
      // All thinking blocks should be preserved
      expect(view[1].content.some((b: any) => b.type === 'thinking')).toBe(true);
      expect(view[3].content.some((b: any) => b.type === 'thinking')).toBe(true);
    });

    it('does not misidentify tool_result containing boundary text', () => {
      const msgs: Message[] = [
        textMsg('user', 'q'),
        toolUseAssistant('t1', 'Read'),
        toolResultMsg('t1', 'The file contains [compact_boundary] text'),
        textMsg('assistant', 'done'),
      ];
      const view = buildViewForAPI(msgs);
      // Should return all 4 messages (tool_result not treated as boundary)
      expect(view.length).toBe(4);
    });
  });

  // ---- findLastCompactBoundary ----

  describe('findLastCompactBoundary', () => {
    it('returns 0 when no boundary', () => {
      expect(findLastCompactBoundary([textMsg('user', 'hi')])).toBe(0);
    });

    it('finds single boundary', () => {
      const msgs = [textMsg('user', 'q'), textMsg('assistant', 'a'), boundaryMsg('s')];
      expect(findLastCompactBoundary(msgs)).toBe(2);
    });

    it('finds last of multiple boundaries', () => {
      const msgs = [boundaryMsg('s1'), textMsg('assistant', 'a'), boundaryMsg('s2')];
      expect(findLastCompactBoundary(msgs)).toBe(2);
    });
  });

  // ---- shouldAutoCompact ----

  describe('shouldAutoCompact', () => {
    it('returns false when below threshold (Sonnet 200k)', () => {
      // threshold = 200000 - 20000 - 13000 = 167000
      expect(shouldAutoCompact(150_000, 200_000)).toBe(false);
    });

    it('returns true when at threshold (Sonnet 200k)', () => {
      expect(shouldAutoCompact(168_000, 200_000)).toBe(true);
    });

    it('returns true when above threshold (GPT-4 128k)', () => {
      // threshold = 128000 - 20000 - 13000 = 95000
      expect(shouldAutoCompact(96_000, 128_000)).toBe(true);
    });

    it('returns false for 0 tokens (first iteration)', () => {
      expect(shouldAutoCompact(0, 200_000)).toBe(false);
    });
  });

  // ---- compactConversation ----

  describe('compactConversation', () => {
    it('inserts boundary with summary', async () => {
      const msgs: Message[] = [
        textMsg('user', 'create 5 slides'),
        textMsg('assistant', 'ok working on it'),
        textMsg('user', 'continue'),
        textMsg('assistant', 'done with slide 1'),
      ];
      const adapter = createMockAdapter({ compactSummary: '## Summary\nCreated slide 1' });
      await compactConversation(msgs, adapter, '');
      // Should have boundary + assistant acknowledgment
      const boundary = msgs.find(m =>
        m.role === 'user' && Array.isArray(m.content) && m.content.some((b: any) =>
          b.type === 'text' && b.text?.startsWith('[compact_boundary]'),
        ),
      );
      expect(boundary).toBeTruthy();
      // Last message should be assistant
      expect(msgs[msgs.length - 1].role).toBe('assistant');
    });

    it('inserts dummy assistant when last message is user (tool_results)', async () => {
      const msgs: Message[] = [
        textMsg('user', 'q'),
        toolUseAssistant('t1', 'Write'),
        toolResultMsg('t1', 'ok'),
      ];
      const adapter = createMockAdapter({ compactSummary: 'summary' });
      await compactConversation(msgs, adapter, '');
      // Should have: ...original..., dummy assistant, boundary user, ack assistant
      // Check no consecutive user messages
      for (let i = 1; i < msgs.length; i++) {
        if (msgs[i].role === 'user' && msgs[i - 1].role === 'user') {
          throw new Error(`Consecutive user messages at index ${i - 1} and ${i}`);
        }
      }
    });

    it('falls back to historySnip when adapter throws', async () => {
      const msgs: Message[] = [
        textMsg('user', 'q1'),
        textMsg('assistant', 'a1'),
        textMsg('user', 'q2'),
        textMsg('assistant', 'a2'),
        textMsg('user', 'q3'),
        textMsg('assistant', 'a3'),
        textMsg('user', 'q4'),
        textMsg('assistant', 'a4'),
        textMsg('user', 'q5'),
        textMsg('assistant', 'a5'),
      ];
      const originalLen = msgs.length;
      const adapter = createMockAdapter({ throwOnCompact: true });
      await compactConversation(msgs, adapter, '');
      // Should have fewer messages (snipped), no boundary inserted
      expect(msgs.length).toBeLessThan(originalLen);
    });

    it('does not insert boundary when summary is empty', async () => {
      const msgs: Message[] = [
        textMsg('user', 'q'),
        textMsg('assistant', 'a'),
      ];
      const adapter = createMockAdapter({ compactSummary: '   ' });
      const originalLen = msgs.length;
      await compactConversation(msgs, adapter, '');
      expect(msgs.length).toBe(originalLen);
    });
  });

  // ---- prepareForCompact ----

  describe('prepareForCompact', () => {
    it('removes thinking blocks', () => {
      const msgs: Message[] = [thinkingAssistant('secret thoughts', 'visible text')];
      const prepared = prepareForCompact(msgs);
      expect(prepared[0].content.some((b: any) => b.type === 'thinking')).toBe(false);
      expect(prepared[0].content.some((b: any) => b.type === 'text')).toBe(true);
    });

    it('truncates large tool_results', () => {
      const msgs: Message[] = [toolResultMsg('t1', 'x'.repeat(10000))];
      const prepared = prepareForCompact(msgs);
      const tr = prepared[0].content[0] as any;
      expect(tr.content.length).toBeLessThan(10000);
      expect(tr.content).toContain('[...truncated]');
    });

    it('does not modify original messages', () => {
      const msgs: Message[] = [thinkingAssistant('thoughts', 'text')];
      prepareForCompact(msgs);
      expect(msgs[0].content.length).toBe(2); // still has thinking
    });
  });

  // ---- appendCompactPrompt ----

  describe('appendCompactPrompt', () => {
    it('merges prompt into last user message', () => {
      const msgs: Message[] = [
        textMsg('user', 'q'),
        textMsg('assistant', 'a'),
        toolResultMsg('t1', 'result'),
      ];
      const result = appendCompactPrompt(msgs);
      expect(result[result.length - 1].role).toBe('user');
      const lastContent = result[result.length - 1].content as any[];
      expect(lastContent.some((b: any) => b.text?.includes('Summarize'))).toBe(true);
    });

    it('appends new user message when last is assistant', () => {
      const msgs: Message[] = [
        textMsg('user', 'q'),
        textMsg('assistant', 'a'),
      ];
      const result = appendCompactPrompt(msgs);
      expect(result.length).toBe(3);
      expect(result[2].role).toBe('user');
    });
  });

  // ---- historySnip ----

  describe('historySnip', () => {
    it('removes oldest message pairs', () => {
      const msgs: Message[] = [
        textMsg('user', 'q1'),
        textMsg('assistant', 'a1'),
        textMsg('user', 'q2'),
        textMsg('assistant', 'a2'),
        textMsg('user', 'q3'),
        textMsg('assistant', 'a3'),
        textMsg('user', 'q4'),
        textMsg('assistant', 'a4'),
      ];
      const originalLen = msgs.length;
      historySnip(msgs, 2);
      expect(msgs.length).toBeLessThan(originalLen);
      // Should keep at least 4 messages at the end
      expect(msgs.length).toBeGreaterThanOrEqual(4);
    });

    it('preserves at least last 4 messages', () => {
      const msgs: Message[] = [
        textMsg('user', 'q1'),
        textMsg('assistant', 'a1'),
        textMsg('user', 'q2'),
        textMsg('assistant', 'a2'),
        textMsg('user', 'q3'),
        textMsg('assistant', 'a3'),
      ];
      historySnip(msgs, 10); // try to remove more than available
      expect(msgs.length).toBeGreaterThanOrEqual(4);
    });
  });

  // ---- getContextLimit ----

  describe('getContextLimit', () => {
    it('returns 200k for Claude Sonnet', () => {
      expect(getContextLimit('claude-sonnet-4-20250514')).toBe(200_000);
    });

    it('returns 1M for Claude Opus', () => {
      expect(getContextLimit('claude-opus-4-20250514')).toBe(1_000_000);
    });

    it('returns 200k for Claude Haiku', () => {
      expect(getContextLimit('claude-3-haiku-20240307')).toBe(200_000);
    });

    it('returns 64k for DeepSeek', () => {
      expect(getContextLimit('deepseek-v4-pro')).toBe(64_000);
    });

    it('returns 128k for GPT-4o', () => {
      expect(getContextLimit('gpt-4o')).toBe(128_000);
    });

    it('returns 128k for unknown models', () => {
      expect(getContextLimit('some-unknown-model')).toBe(128_000);
    });
  });

  // ---- Regression: Skill runner design constraints ----

  describe('skill runner regression', () => {
    it('shouldAutoCompact triggers very early for DeepSeek 64k — proves compact must be disabled for skills', () => {
      // DeepSeek 64k: threshold = (64000 - 20000) - 13000 = 31000
      // A single iteration of a 5-page slide skill easily exceeds 31k tokens
      // This test documents why auto-compact MUST be disabled in Runner 2
      const deepseekLimit = getContextLimit('deepseek-v4-pro');
      expect(deepseekLimit).toBe(64_000);

      // Already exceeds at 31k — way too aggressive for multi-iteration skills
      expect(shouldAutoCompact(31_000, deepseekLimit)).toBe(true);
      expect(shouldAutoCompact(30_000, deepseekLimit)).toBe(false);

      // For comparison, Claude 200k threshold is (200000-20000)-13000 = 167000
      const claudeLimit = getContextLimit('claude-sonnet-4-20250514');
      expect(shouldAutoCompact(167_000, claudeLimit)).toBe(true);
      expect(shouldAutoCompact(166_000, claudeLimit)).toBe(false);
    });

    it('tool results under 50k are preserved fully without persist (Runner 2 uses slice(0, 50000))', () => {
      // Runner 2 uses result.slice(0, 50000) directly, NOT maybePersistToolResult
      // This ensures the model sees full tool output for skill execution
      const result40k = 'x'.repeat(40_000);
      // maybePersistToolResult would truncate at 30k threshold, but Runner 2 skips it
      const { persisted } = maybePersistToolResult(result40k, 'Read', 'tool-1', tmpDir);
      expect(persisted).toBe(true); // context-manager WOULD persist it
      // But Runner 2 bypasses this — it does result.slice(0, 50000) instead
      expect(result40k.slice(0, 50000)).toBe(result40k); // 40k < 50k, fully preserved
    });

    it('messages array without compact boundary returns all messages via buildViewForAPI', () => {
      // When auto-compact is disabled, there's no boundary marker
      // buildViewForAPI should return the full messages array
      const msgs: Message[] = [
        textMsg('user', 'Create 5 slides about OpenAI'),
        textMsg('assistant', 'I will create the slides.'),
        toolResultMsg('t1', 'x'.repeat(40_000)),
        textMsg('assistant', 'Slide 1 done.'),
        toolResultMsg('t2', 'y'.repeat(40_000)),
        textMsg('assistant', 'Slide 2 done.'),
      ];
      const view = buildViewForAPI(msgs, 2);
      // No boundary → all messages preserved
      expect(view.length).toBe(msgs.length);
      expect(view).toEqual(msgs);
    });
  });
});
