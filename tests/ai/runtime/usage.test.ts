import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { estimateTokens, mergeUsage, shouldCompact, truncateToolResult, compactMessages } from '../../../src/ai/runtime/usage.js';
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

describe('compactMessages', () => {
  it('uses LLM summary when provided', () => {
    const messages = Array.from({ length: 20 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: [{ type: 'text', text: `msg-${i}` }],
    }));

    const result = compactMessages(messages, '[fallback]', 2, 'LLM_SUMMARY');

    expect(result.summary.text).toBe('LLM_SUMMARY');
    expect(result.summary.replacedMessages).toBe(18);
    // First message should be the compact marker with LLM summary
    expect(result.messages[0].content[0]).toEqual({ type: 'text', text: 'LLM_SUMMARY' });
    // Last 2 messages should be preserved
    expect(result.messages.length).toBe(3);
    expect(result.messages[2].content[0]).toEqual({ type: 'text', text: 'msg-19' });
  });

  it('falls back to local summary when llmSummary is not provided', () => {
    const messages = Array.from({ length: 20 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: [{ type: 'text', text: `msg-${i}` }],
    }));

    const result = compactMessages(messages, '[fallback]', 2);

    // Local summary should contain some content
    expect(result.summary.text.length).toBeGreaterThan(0);
    // First message should be user role with local summary
    expect(result.messages[0].role).toBe('user');
    expect(result.messages[0].content[0].type).toBe('text');
  });

  it('preserves tool_use/result pairing across compact', () => {
    const messages = [
      { role: 'user', content: [{ type: 'text', text: 'list files' }] },
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'tu1', name: 'bash', input: { command: 'ls' } }],
      },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'f1\nf2' }],
      },
      { role: 'assistant', content: [{ type: 'text', text: 'done' }] },
    ];

    const result = compactMessages(messages, '[summary]', 2);

    // With keepRecent=2, the last 2 messages are preserved
    // tool_use and tool_result are both in the preserved portion
    const toolUses = result.messages.flatMap(m =>
      m.content.filter((c: any) => c.type === 'tool_use')
    );
    const toolResults = result.messages.flatMap(m =>
      m.content.filter((c: any) => c.type === 'tool_result')
    );
    for (const tu of toolUses) {
      const match = toolResults.some((tr: any) => tr.tool_use_id === tu.id);
      expect(match).toBe(true);
    }
  });
});
