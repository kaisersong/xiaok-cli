import { describe, expect, it, vi } from 'vitest';
import {
  TranscriptBuffer,
  TRANSCRIPT_ENTRY_BYTE_LIMIT,
  TRANSCRIPT_SESSION_BYTE_LIMIT,
  renderTranscriptText,
  type TranscriptBufferEntry,
} from '../../src/ui/transcript-buffer.js';
import { setColorsEnabled } from '../../src/ui/render.js';

setColorsEnabled(false);

describe('TranscriptBuffer recording', () => {
  it('keeps entries in arrival order', () => {
    const buffer = new TranscriptBuffer();
    buffer.record({ kind: 'user', text: 'hello' });
    buffer.record({ kind: 'tool_use', agentId: 'main', name: 'read', summary: 'read notes.txt' });
    buffer.record({ kind: 'tool_result', agentId: 'main', name: 'read', content: 'file body', isError: false });
    buffer.record({ kind: 'assistant', text: 'done' });

    expect(buffer.getEntries().map((entry) => entry.kind)).toEqual([
      'user',
      'tool_use',
      'tool_result',
      'assistant',
    ]);
  });

  it('records image entries without base64 payloads', () => {
    const buffer = new TranscriptBuffer();
    buffer.record({ kind: 'image', mediaType: 'image/png', width: 1388, height: 278 });

    const entry = buffer.getEntries()[0];
    expect(entry).toEqual({ kind: 'image', mediaType: 'image/png', width: 1388, height: 278 });
    expect(JSON.stringify(entry)).not.toContain('data');
  });

  it('reports whether anything has been recorded', () => {
    const buffer = new TranscriptBuffer();
    expect(buffer.isEmpty()).toBe(true);
    buffer.record({ kind: 'system', text: 'session resumed' });
    expect(buffer.isEmpty()).toBe(false);
    buffer.clear();
    expect(buffer.isEmpty()).toBe(true);
    expect(buffer.getTotalBytes()).toBe(0);
  });

  it('exposes the documented capacity limits', () => {
    expect(TRANSCRIPT_ENTRY_BYTE_LIMIT).toBe(64 * 1024);
    expect(TRANSCRIPT_SESSION_BYTE_LIMIT).toBe(8 * 1024 * 1024);
  });
});

describe('TranscriptBuffer capacity boundaries', () => {
  it('truncates a single oversized tool result and annotates the original size', () => {
    const buffer = new TranscriptBuffer({ entryByteLimit: 1024 });
    buffer.record({
      kind: 'tool_result',
      agentId: 'main',
      name: 'bash',
      content: 'x'.repeat(100 * 1024),
      isError: false,
    });

    const entry = buffer.getEntries()[0] as Extract<TranscriptBufferEntry, { kind: 'tool_result' }>;
    expect(entry.content.length).toBeLessThan(100 * 1024);
    expect(entry.content).toContain('[truncated, original 100 KB]');
    expect(Buffer.byteLength(entry.content, 'utf8')).toBeLessThanOrEqual(1024 + 64);
  });

  it('truncates oversized assistant text as well', () => {
    const buffer = new TranscriptBuffer({ entryByteLimit: 512 });
    buffer.record({ kind: 'assistant', text: 'y'.repeat(4096) });

    const entry = buffer.getEntries()[0] as Extract<TranscriptBufferEntry, { kind: 'assistant' }>;
    expect(entry.text).toContain('[truncated, original 4 KB]');
  });

  it('does not truncate multi-byte characters into invalid sequences', () => {
    const buffer = new TranscriptBuffer({ entryByteLimit: 64 });
    buffer.record({ kind: 'assistant', text: '中'.repeat(200) });

    const entry = buffer.getEntries()[0] as Extract<TranscriptBufferEntry, { kind: 'assistant' }>;
    expect(entry.text).not.toContain('\ufffd');
  });

  it('evicts the oldest tool_result contents when the session limit is exceeded', () => {
    const buffer = new TranscriptBuffer({ entryByteLimit: 8 * 1024, sessionByteLimit: 16 * 1024 });
    for (let index = 0; index < 6; index += 1) {
      buffer.record({
        kind: 'tool_result',
        agentId: 'main',
        name: `tool-${index}`,
        content: `${index}`.repeat(6 * 1024),
        isError: false,
      });
    }

    const entries = buffer.getEntries() as Extract<TranscriptBufferEntry, { kind: 'tool_result' }>[];
    expect(entries).toHaveLength(6);
    expect(entries[0].name).toBe('tool-0');
    expect(entries[0].content).toContain('[evicted');
    expect(entries[entries.length - 1].content).not.toContain('[evicted');
    expect(buffer.getTotalBytes()).toBeLessThanOrEqual(16 * 1024);
  });

  it('keeps the entry skeleton of evicted results', () => {
    const buffer = new TranscriptBuffer({ entryByteLimit: 4 * 1024, sessionByteLimit: 4 * 1024 });
    buffer.record({ kind: 'tool_result', agentId: 'sub', name: 'grep', content: 'a'.repeat(3 * 1024), isError: true });
    buffer.record({ kind: 'tool_result', agentId: 'main', name: 'bash', content: 'b'.repeat(3 * 1024), isError: false });

    const entries = buffer.getEntries() as Extract<TranscriptBufferEntry, { kind: 'tool_result' }>[];
    expect(entries[0].name).toBe('grep');
    expect(entries[0].agentId).toBe('sub');
    expect(entries[0].isError).toBe(true);
  });

  it('never drops non tool_result entries during eviction', () => {
    const buffer = new TranscriptBuffer({ entryByteLimit: 4 * 1024, sessionByteLimit: 4 * 1024 });
    buffer.record({ kind: 'user', text: 'keep me' });
    buffer.record({ kind: 'tool_result', agentId: 'main', name: 'bash', content: 'c'.repeat(3 * 1024), isError: false });
    buffer.record({ kind: 'tool_result', agentId: 'main', name: 'bash', content: 'd'.repeat(3 * 1024), isError: false });

    const kinds = buffer.getEntries().map((entry) => entry.kind);
    expect(kinds).toEqual(['user', 'tool_result', 'tool_result']);
    expect(buffer.getEntries()[0]).toEqual({ kind: 'user', text: 'keep me' });
  });
});

describe('TranscriptBuffer failure isolation', () => {
  it('swallows errors raised while reading the entry and reports them to onError', () => {
    const onError = vi.fn();
    const buffer = new TranscriptBuffer({ onError });
    const hostile = {
      kind: 'tool_result',
      agentId: 'main',
      name: 'bash',
      isError: false,
      get content(): string {
        throw new Error('serialization boom');
      },
    } as unknown as TranscriptBufferEntry;

    expect(() => buffer.record(hostile)).not.toThrow();
    expect(buffer.getEntries()).toHaveLength(0);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('keeps accepting entries after a failed record', () => {
    const buffer = new TranscriptBuffer();
    const hostile = {
      kind: 'assistant',
      get text(): string {
        throw new Error('boom');
      },
    } as unknown as TranscriptBufferEntry;

    buffer.record(hostile);
    buffer.record({ kind: 'assistant', text: 'still working' });

    expect(buffer.getEntries()).toEqual([{ kind: 'assistant', text: 'still working' }]);
  });
});

describe('renderTranscriptText', () => {
  it('renders user, assistant, tool and command entries', () => {
    const text = renderTranscriptText([
      { kind: 'user', text: '看一下 notes.txt' },
      { kind: 'tool_use', agentId: 'main', name: 'read', summary: 'read notes.txt' },
      { kind: 'tool_result', agentId: 'main', name: 'read', content: 'project file fixture line', isError: false },
      { kind: 'assistant', text: 'notes.txt 只有一行。' },
      { kind: 'command_output', command: '/status', output: 'model: gpt-terminal-e2e' },
    ]);

    expect(text).toContain('看一下 notes.txt');
    expect(text).toContain('read notes.txt');
    expect(text).toContain('project file fixture line');
    expect(text).toContain('notes.txt 只有一行。');
    expect(text).toContain('/status');
    expect(text).toContain('model: gpt-terminal-e2e');
  });

  it('renders tool_result contents in full instead of a 100 character summary', () => {
    const content = 'z'.repeat(600);
    const text = renderTranscriptText([
      { kind: 'tool_result', agentId: 'main', name: 'bash', content, isError: false },
    ]);

    const reconstructed = text
      .split('\n')
      .filter((line) => line.startsWith('  │ ') && !line.includes('bash (ok)'))
      .map((line) => line.slice('  │ '.length))
      .join('');
    expect(reconstructed).toContain(content.slice(0, 600));
    expect(text).not.toContain('...');
  });

  it('keeps multiline tool history inside rails without the legacy arrow', () => {
    const text = renderTranscriptText([
      { kind: 'tool_use', agentId: 'main', name: 'edit', summary: '修改文件 cli.py' },
      {
        kind: 'tool_result',
        agentId: 'main',
        name: 'edit',
        content: 'diff --git a/cli.py b/cli.py\n--- a/cli.py\n+++ b/cli.py\n@@ -1 +1 @@',
        isError: false,
      },
    ]);
    const toolLines = text.split('\n').filter((line) => line.trim().length > 0);

    expect(text).not.toContain('↳');
    expect(text).not.toContain('\n---');
    expect(text).not.toContain('\n+++');
    expect(toolLines.every((line) => line.startsWith('  │ '))).toBe(true);
  });

  it('prefixes subagent entries with the agent name', () => {
    const text = renderTranscriptText([
      { kind: 'tool_use', agentId: 'Explore', name: 'grep', summary: 'grep TODO' },
      { kind: 'tool_result', agentId: 'Explore', name: 'grep', content: 'found 2 matches', isError: false },
    ]);

    expect(text).toContain('[subagent: Explore]');
    expect(text.match(/\[subagent: Explore\]/g)).toHaveLength(2);
  });

  it('does not prefix main-agent entries', () => {
    const text = renderTranscriptText([
      { kind: 'tool_use', agentId: 'main', name: 'grep', summary: 'grep TODO' },
    ]);

    expect(text).not.toContain('subagent');
  });

  it('marks error results', () => {
    const text = renderTranscriptText([
      { kind: 'tool_result', agentId: 'main', name: 'bash', content: 'Error: no such file', isError: true },
    ]);

    expect(text).toContain('(error)');
    expect(text).toContain('Error: no such file');
  });

  it('renders images as fallback text with dimensions', () => {
    const text = renderTranscriptText([
      { kind: 'image', mediaType: 'image/png', width: 1388, height: 278 },
      { kind: 'image', mediaType: 'image/webp' },
    ]);

    expect(text).toContain('[Image 1388×278]');
    expect(text).toContain('[Image]');
    expect(text).not.toContain('↳');
    expect(text.split('\n').filter((line) => line.includes('[Image]') || line.includes('[Image 1388×278]'))
      .every((line) => line.startsWith('  │ '))).toBe(true);
  });

  it('renders thinking entries', () => {
    const text = renderTranscriptText([{ kind: 'thinking', text: '先读文件再回答' }]);
    expect(text).toContain('先读文件再回答');
  });

  it('returns a hint when the buffer is empty', () => {
    expect(renderTranscriptText([]).trim().length).toBeGreaterThan(0);
  });

  it('ends with a trailing newline so pagers show the final row', () => {
    const text = renderTranscriptText([{ kind: 'user', text: 'hi' }]);
    expect(text.endsWith('\n')).toBe(true);
  });
});
