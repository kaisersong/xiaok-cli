// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { streamDesktopSummaryRecovery } from '../../electron/desktop-summary-stream.js';

const request = (adapter: any, extra: any = {}) => ({ adapter, messages: [{ role: 'user', content: [{ type: 'text', text: 'summarize' }] }],
  tools: [{ name: 'spawn_agent', description: '', inputSchema: { type: 'object', properties: {} } }], systemPrompt: '',
  options: { signal: new AbortController().signal }, invocationId: 'first', deadline: Date.now() + 10000,
  canRecover: () => true, ...extra });
async function collect(input: any) { const result = []; for await (const x of streamDesktopSummaryRecovery(input)) result.push(x); return result; }
describe('summary-only stream recovery', () => {
  it.each(['original-done', 'original-text', 'recovery-done', 'recovery-tool'])('preserves late usage and abort identity: %s', async mode => {
    const controller = new AbortController();
    const reason = new DOMException('cancelled by user', 'AbortError');
    let calls = 0;
    const received: any[] = [];
    const adapter = { async *stream() {
      calls++;
      if (mode.startsWith('recovery') && calls === 1) {
        yield { type: 'text', delta: 'prefix' }; throw new Error('terminated');
      }
      controller.abort(reason);
      yield { type: 'usage', usage: { inputTokens: 12, outputTokens: 3 } };
      if (mode.endsWith('text')) yield { type: 'text', delta: 'must not be delivered' };
      if (mode.endsWith('tool')) yield { type: 'tool_use', id: 'no', name: 'spawn_agent', input: {} };
      yield { type: 'done' };
    } };
    await expect((async () => {
      for await (const chunk of streamDesktopSummaryRecovery(request(adapter, { options: { signal: controller.signal } }))) received.push(chunk);
    })()).rejects.toBe(reason);
    expect(received.filter(x => x.type === 'usage')).toEqual([{ type: 'usage', usage: { inputTokens: 12, outputTokens: 3 } }]);
    expect(received.some(x => x.type === 'tool_use' || x.delta === 'must not be delivered')).toBe(false);
    expect(calls).toBe(mode.startsWith('recovery') ? 2 : 1);
  });
  it('continues once with preserved prefix, no tools, and a fresh usage invocation', async () => {
    const calls: any[] = [], ids: string[] = [];
    const adapter = { async *stream(messages: any, tools: any) { calls.push({ messages, tools });
      if (calls.length === 1) { yield { type: 'text', delta: 'already delivered' }; throw new Error('terminated'); }
      yield { type: 'text', delta: ' continuation' }; yield { type: 'done' };
    } };
    const result = await collect(request(adapter, { onInvocation: (id: string) => ids.push(id) }));
    expect(result.filter(x => x.type === 'text').map(x => x.delta).join('')).toBe('already delivered continuation');
    expect(calls).toHaveLength(2); expect(calls[1].tools).toEqual([]);
    expect(JSON.stringify(calls[1].messages)).toContain('already delivered');
    expect(ids).toHaveLength(2); expect(ids[0]).not.toBe(ids[1]);
  });
  it.each(['no-text', 'tool', 'abort', 'ineligible', 'permanent'])('does not recover %s', async mode => {
    let calls = 0; const ctl = new AbortController();
    const adapter = { async *stream() { calls++;
      if (mode !== 'no-text') yield { type: 'text', delta: 'prefix' };
      if (mode === 'tool') yield { type: 'tool_use', id: 'x', name: 'spawn_agent', input: {} };
      if (mode === 'abort') ctl.abort();
      throw new Error(mode === 'permanent' ? 'invalid authorization' : 'terminated');
    } };
    await expect(collect(request(adapter, { options: { signal: ctl.signal }, canRecover: () => mode !== 'ineligible' }))).rejects.toThrow();
    expect(calls).toBe(1);
  });
  it('does not catch a consumer persistence error', async () => {
    let calls = 0; const adapter = { async *stream() { calls++; yield { type: 'text', delta: 'prefix' }; } };
    await expect((async () => { for await (const _chunk of streamDesktopSummaryRecovery(request(adapter))) throw new Error('terminated journal'); })()).rejects.toThrow('journal');
    expect(calls).toBe(1);
  });
  it('fails on a second disconnect', async () => {
    let calls = 0; const adapter = { async *stream() { calls++; yield { type: 'text', delta: 'prefix' }; throw new Error('terminated'); } };
    await expect(collect(request(adapter))).rejects.toThrow('terminated'); expect(calls).toBe(2);
  });
  it('rejects tools emitted by the recovery provider', async () => {
    let calls = 0; const adapter = { async *stream() { if (++calls === 1) { yield { type: 'text', delta: 'prefix' }; throw new Error('terminated'); }
      yield { type: 'tool_use', id: 'duplicate', name: 'spawn_agent', input: {} };
    } };
    await expect(collect(request(adapter))).rejects.toThrow(/recovery.*tool/);
  });
  it('keeps tools disabled on subsequent mailbox iterations', async () => {
    const adapter = { async *stream(_messages: any, tools: any) {
      expect(tools).toEqual([]); yield { type: 'tool_use', id: 'again', name: 'spawn_agent', input: {} };
    } };
    await expect(collect(request(adapter, { summaryOnly: true }))).rejects.toThrow(/recovery.*tool/);
  });
  it.each(['permission', 'deadline', 'empty'])('fails safely on %s', async mode => {
    let calls = 0;
    const input = request({ async *stream() {
      if (++calls === 1) { yield { type: 'text', delta: 'prefix' };
        if (mode === 'deadline') input.deadline = 0;
        throw new Error('terminated');
      }
      yield { type: 'done' };
    } }, { canRecover: () => { if (mode === 'permission') throw new Error('permission revoked'); return true; } });
    await expect(collect(input)).rejects.toThrow();
    expect(calls).toBe(mode === 'empty' ? 2 : 1);
  });
});
