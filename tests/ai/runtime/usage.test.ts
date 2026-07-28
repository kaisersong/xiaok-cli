import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  applyCompactionPlan,
  compactMessages,
  computeCost,
  computeCostWithConfidence,
  estimateTokens,
  mergeUsage,
  planCompaction,
  shouldCompact,
  truncateToolResult,
} from '../../../src/ai/runtime/usage.js';
import type { Message } from '../../../src/types.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';

describe('runtime usage helpers', () => {
  it('estimates tokens from block content', () => {
    expect(
      estimateTokens([
        { role: 'user', content: [{ type: 'text', text: 'hello world' }] },
      ])
    ).toBeGreaterThan(0);
  });

  it('requests compact when threshold exceeded', () => {
    expect(shouldCompact(180_000, 200_000, 0.85)).toBe(true);
    expect(shouldCompact(80_000, 200_000, 0.85)).toBe(false);
  });

  it('omits optional usage fields when they are undefined', () => {
    expect(
      mergeUsage(
        { inputTokens: 1, outputTokens: 2 },
        { inputTokens: 10, outputTokens: 5 },
      )
    ).toEqual({
      inputTokens: 10,
      outputTokens: 5,
    });
  });

  it('preserves base values when next has zero tokens (message_delta scenario)', () => {
    const afterStart = mergeUsage(
      { inputTokens: 0, outputTokens: 0 },
      { inputTokens: 5000, outputTokens: 100 },
    );
    expect(afterStart).toEqual({ inputTokens: 5000, outputTokens: 100 });

    const afterDelta = mergeUsage(
      afterStart,
      { inputTokens: 0, outputTokens: 300 },
    );
    expect(afterDelta.inputTokens).toBe(5000);
    expect(afterDelta.outputTokens).toBe(300);
  });

  it('fully replaces when next has non-zero for both', () => {
    expect(
      mergeUsage(
        { inputTokens: 5000, outputTokens: 100 },
        { inputTokens: 6000, outputTokens: 200 },
      )
    ).toEqual({
      inputTokens: 6000,
      outputTokens: 200,
    });
  });
});

describe('compaction planning', () => {
  it('freezes only the replaceable prefix and retains the recent suffix', () => {
    const messages: Message[] = [
      { role: 'user', content: [{ type: 'text', text: 'old request' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'old answer' }] },
      { role: 'user', content: [{ type: 'text', text: 'recent request' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'recent answer' }] },
    ];

    const plan = planCompaction(messages, 7, 2);

    expect(plan.sourceRevision).toBe(7);
    expect(plan.sourceMessageCount).toBe(4);
    expect(plan.messagesToSummarize).toEqual(messages.slice(0, 2));
    expect(plan.messagesToRetain).toEqual(messages.slice(2));
    expect(plan.messagesToSummarize).not.toBe(messages);
    expect(plan.messagesToRetain).not.toBe(messages);

    messages[0]!.content[0] = { type: 'text', text: 'mutated after planning' };
    expect((plan.messagesToSummarize[0]!.content[0] as { text: string }).text).toBe('old request');
  });

  it('retains from the earliest tool call required by multiple recent results', () => {
    const messages: Message[] = [
      { role: 'user', content: [{ type: 'text', text: 'old' }] },
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'call_early', name: 'read', input: { path: 'a' } }],
      },
      { role: 'assistant', content: [{ type: 'text', text: 'between calls' }] },
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'call_late', name: 'read', input: { path: 'b' } }],
      },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'call_early', content: 'A' },
          { type: 'tool_result', tool_use_id: 'call_late', content: 'B' },
        ],
      },
      { role: 'assistant', content: [{ type: 'text', text: 'recent' }] },
    ];

    const plan = planCompaction(messages, 1, 2);

    expect(plan.invalidReason).toBeUndefined();
    expect(plan.messagesToSummarize).toEqual(messages.slice(0, 1));
    expect(plan.messagesToRetain).toEqual(messages.slice(1));
  });

  it.each([
    {
      name: 'orphan result',
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'old' }] },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'missing', content: 'x' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'recent' }] },
      ] satisfies Message[],
      reason: 'unpaired_tool_result',
    },
    {
      name: 'duplicate call id',
      messages: [
        {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'dup', name: 'read', input: { path: 'a' } }],
        },
        {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'dup', name: 'read', input: { path: 'b' } }],
        },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'dup', content: 'x' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'recent' }] },
      ] satisfies Message[],
      reason: 'duplicate_tool_call_id',
    },
  ])('marks $name as an invalid plan', ({ messages, reason }) => {
    const plan = planCompaction(messages, 1, 2);

    expect(plan.invalidReason).toBe(reason);
    expect(plan.replacedMessages).toBe(0);
  });

  it('uses an explicit bounded summary when it yields at least five percent reduction', () => {
    const messages: Message[] = [
      { role: 'user', content: [{ type: 'text', text: `old request ${'a'.repeat(10_000)}` }] },
      { role: 'assistant', content: [{ type: 'text', text: `old answer ${'b'.repeat(10_000)}` }] },
      { role: 'user', content: [{ type: 'text', text: 'recent request' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'recent answer' }] },
    ];
    const plan = planCompaction(messages, 1, 2);

    const result = applyCompactionPlan(plan, 'LLM summary with exact retained facts');

    expect(result.status).toBe('compacted');
    expect(result.summary.text).toBe('LLM summary with exact retained facts');
    expect((result.messages[0]!.content[0] as { text: string }).text)
      .toBe('LLM summary with exact retained facts');
  });

  it('keeps the legacy positional compactMessages API while applying the supplied summary', () => {
    const messages: Message[] = [
      { role: 'user', content: [{ type: 'text', text: `old request ${'a'.repeat(10_000)}` }] },
      { role: 'assistant', content: [{ type: 'text', text: 'recent answer' }] },
      { role: 'user', content: [{ type: 'text', text: 'recent request' }] },
    ];

    const result = compactMessages(messages, 'legacy caller summary', 2);

    expect(result.summary.text).toBe('legacy caller summary');
    expect((result.messages[0]!.content[0] as { text: string }).text)
      .toBe('legacy caller summary');
  });

  it('falls back from whitespace and oversized summaries to a bounded deterministic summary', () => {
    const messages: Message[] = [
      { role: 'user', content: [{ type: 'text', text: `old request ${'a'.repeat(10_000)}` }] },
      { role: 'assistant', content: [{ type: 'text', text: `old answer ${'b'.repeat(10_000)}` }] },
      { role: 'user', content: [{ type: 'text', text: 'recent request' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'recent answer' }] },
    ];

    for (const summary of ['   ', 'x'.repeat(8_001)]) {
      const result = applyCompactionPlan(planCompaction(messages, 1, 2), summary);
      expect(result.status).toBe('compacted');
      expect(result.summary.text).toContain('[context compacted summary]');
      expect(result.summary.text.length).toBeLessThanOrEqual(8_000);
    }
  });

  it('falls back when a within-limit LLM summary has no net gain', () => {
    const messages: Message[] = [
      { role: 'user', content: [{ type: 'text', text: `old request ${'a'.repeat(3_500)}` }] },
      { role: 'assistant', content: [{ type: 'text', text: `old answer ${'b'.repeat(3_500)}` }] },
      { role: 'user', content: [{ type: 'text', text: 'recent request' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'recent answer' }] },
    ];

    const result = applyCompactionPlan(planCompaction(messages, 1, 2), 'x'.repeat(7_999));

    expect(result.status).toBe('compacted');
    expect(result.summary.text).toContain('[context compacted summary]');
  });

  it('returns no_gain without changing the planned history when even deterministic fallback cannot shrink it', () => {
    const messages: Message[] = [
      { role: 'user', content: [{ type: 'text', text: 'a' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'b' }] },
      { role: 'user', content: [{ type: 'text', text: 'c' }] },
    ];
    const plan = planCompaction(messages, 1, 2);

    const result = applyCompactionPlan(plan, 'an expansion rather than a summary');

    expect(result.status).toBe('no_gain');
    expect(result.messages).toEqual(messages);
    expect(result.messages).not.toBe(messages);
    expect(result.summary.replacedMessages).toBe(0);
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid keepRecent value %s',
    (keepRecent) => {
      expect(() => planCompaction([], 0, keepRecent)).toThrow(/keepRecent/);
    },
  );
});

describe('truncateToolResult', () => {
  it('returns content unchanged when under threshold', () => {
    const short = 'a'.repeat(7999);
    const result = truncateToolResult(short);
    expect(result.content).toBe(short);
    expect(result.spillPath).toBeUndefined();
    expect(result.hint).toBeUndefined();
  });

  it('truncates content exceeding threshold (legacy: no spill)', () => {
    const long = 'a'.repeat(12000);
    const result = truncateToolResult(long);
    expect(result.content.length).toBeLessThan(long.length);
    expect(result.content).toContain('truncated');
    expect(result.spillPath).toBeUndefined();
  });

  it('respects custom threshold', () => {
    const content = 'x'.repeat(200);
    const result = truncateToolResult(content, 100);
    expect(result.content.length).toBeLessThan(200);
    expect(result.content).toContain('truncated');
  });

  it('truncation boundary: content over threshold is truncated + notice appended', () => {
    const threshold = 8000;
    const text = 'x'.repeat(threshold);
    const result = truncateToolResult(text, threshold);
    expect(result.spillPath).toBeUndefined(); // no spill without options
    expect(result.content.length).toBe(threshold); // exact threshold since content == threshold, not >

    const overText = 'x'.repeat(threshold + 1000);
    const overResult = truncateToolResult(overText, threshold);
    expect(overResult.spillPath).toBeUndefined();
    expect(overResult.content.length).toBeLessThan(overText.length);
    expect(overResult.content.length).toBeGreaterThan(threshold); // includes notice
    expect(overResult.content).toContain('truncated');
  });
});

describe('truncateToolResult with spill', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `spill-test-${Date.now()}`);
  });

  afterEach(() => {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('small result: no spill, content unchanged', () => {
    const result = truncateToolResult('short text', 8000, {
      sessionId: 's1',
      toolCallId: 'tc1',
      spillDir: tmpDir,
    });
    expect(result.content).toBe('short text');
    expect(result.spillPath).toBeUndefined();
    expect(result.hint).toBeUndefined();
  });

  it('large result: truncated + spill file + hint', () => {
    const longText = 'A'.repeat(20000);
    const result = truncateToolResult(longText, 8000, {
      sessionId: 's1',
      toolCallId: 'tc1',
      spillDir: tmpDir,
    });

    expect(result.content.length).toBeLessThan(longText.length);
    expect(result.content).toContain('.xiaok/spill/s1/tc1');
    expect(result.spillPath).toBeDefined();
    expect(result.spillPath).toContain('s1');
    expect(result.spillPath).toContain('tc1');
    expect(existsSync(result.spillPath!)).toBe(true);
    expect(readFileSync(result.spillPath!, 'utf-8')).toBe(longText);
  });

  it('toolCallId with traversal: sanitized, safe filename', () => {
    const result = truncateToolResult('A'.repeat(20000), 8000, {
      sessionId: 's1',
      toolCallId: '../../../etc/passwd',
      spillDir: tmpDir,
    });
    // Sanitized ID should not contain path traversal patterns
    expect(result.spillPath).not.toContain('../');
    // Session dir should be 's1'
    expect(result.spillPath).toContain('s1/');
    // Tool call ID should be sanitized (no path components)
    expect(result.spillPath).toContain('etc_passwd.txt');
    expect(existsSync(result.spillPath!)).toBe(true);
    // Verify the actual file content
    expect(readFileSync(result.spillPath!, 'utf-8')).toBe('A'.repeat(20000));
  });

  it('sessionId with traversal: also sanitized', () => {
    const result = truncateToolResult('A'.repeat(20000), 8000, {
      sessionId: '../other-session',
      toolCallId: 'tc1',
      spillDir: tmpDir,
    });
    // Should not have path traversal
    expect(result.spillPath).not.toContain('../');
    // File should exist at a safe location
    expect(existsSync(result.spillPath!)).toBe(true);
  });

  it('write failure: fallback to truncation, no crash', () => {
    const readOnlyDir = '/nonexistent/path/cannot/be/created';
    const result = truncateToolResult('A'.repeat(20000), 8000, {
      sessionId: 's1',
      toolCallId: 'tc1',
      spillDir: readOnlyDir,
    });
    expect(result.content.length).toBeLessThan(20000);
    expect(result.content).toContain('truncated');
    expect(result.spillPath).toBeUndefined();
  });
});

describe('computeCost', () => {
  it('includes input, output, and cache token pricing', () => {
    const cost = computeCost({
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      cacheCreationInputTokens: 1_000_000,
      cacheReadInputTokens: 1_000_000,
    }, 'claude-sonnet-4-20250514');

    expect(cost).toBeCloseTo(22.05, 5);
  });

  it('uses longest-prefix model matching before broad aliases', () => {
    const cost = computeCost({
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    }, 'gpt-4o-mini-2024-07-18');

    expect(cost).toBeCloseTo(0.75, 5);
  });

  it('marks bundled static pricing as estimated and unknown models as unknown', () => {
    expect(computeCostWithConfidence({
      inputTokens: 10_000,
      outputTokens: 5_000,
    }, 'claude-sonnet-4')).toEqual({
      cost: expect.any(Number),
      confidence: 'estimated',
    });

    expect(computeCostWithConfidence({
      inputTokens: 10_000,
      outputTokens: 5_000,
    }, 'unknown-model')).toEqual({
      cost: 0,
      confidence: 'unknown',
    });
  });
});
